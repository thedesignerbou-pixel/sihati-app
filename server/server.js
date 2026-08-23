require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 64) console.warn('WARNING: JWT_SECRET should be at least 64 characters.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized:false } : false });
const publicDir = path.join(__dirname,'public');
const uploadDir = path.join(__dirname,'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const upload = multer({ dest: uploadDir, limits:{fileSize: 8*1024*1024, files:8}, fileFilter:(req,file,cb)=>/^image\/(jpeg|png|webp)$/.test(file.mimetype)?cb(null,true):cb(new Error('الصور المسموحة JPG/PNG/WEBP فقط')) });
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'sihati-images';

app.use(cors({origin:true,credentials:true}));
app.use(express.json({limit:'4mb'}));
app.use('/uploads',express.static(uploadDir));
app.use(express.static(publicDir));

const q = (text,params=[]) => pool.query(text,params);
const safeUser = u => ({id:u.id,name:u.name,email:u.email,phone:u.phone||'',role:u.role,birth_date:u.birth_date,address:u.address,medical_info:u.medical_info,created_at:u.created_at});
function tokenFor(u){ return jwt.sign({sub:u.id,role:u.role},JWT_SECRET,{expiresIn:'30d'}); }
function setAuthCookie(res,token){res.cookie('sihati_token',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:30*24*60*60*1000,path:'/'});}
function auth(req,res,next){
  try{
    const h=req.headers.authorization||''; const bearer=h.startsWith('Bearer ')?h.slice(7):null; const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('sihati_token='))?.slice('sihati_token='.length)||null; const raw=bearer||cookie; if(!raw) return res.status(401).json({message:'خاصك تسجل الدخول'});
    req.auth=jwt.verify(raw,JWT_SECRET); next();
  }catch{return res.status(401).json({message:'جلسة الدخول منتهية، عاود سجل الدخول'});}
}
function role(...roles){return (req,res,next)=>roles.includes(req.auth.role)?next():res.status(403).json({message:'ما عندكش الصلاحية'});}
async function userById(id){const r=await q('select * from users where id=$1',[id]);return r.rows[0];}
async function clinicPayload(id){
  const r=await q(`select c.*,u.name as owner_name,u.email as owner_email,u.phone as owner_phone,
    coalesce((select json_agg(json_build_object('day_of_week',w.day_of_week,'enabled',w.enabled,'from_time',w.from_time,'to_time',w.to_time) order by w.id) from working_hours w where w.clinic_id=c.id),'[]') working_hours,
    coalesce((select json_agg(json_build_object('id',i.id,'url',i.url,'path',i.path) order by i.created_at) from clinic_images i where i.clinic_id=c.id),'[]') images,
    coalesce((select json_agg(json_build_object('id',d.id,'name',d.name,'specialty',d.specialty,'phone',d.phone,'available',d.available) order by d.id) from doctors d where d.clinic_id=c.id),'[]') doctors,
    coalesce((select json_agg(json_build_object('id',s.id,'name',s.name,'price',s.price,'duration_minutes',s.duration_minutes) order by s.id) from services s where s.clinic_id=c.id),'[]') services,
    coalesce((select json_agg(json_build_object('id',rv.id,'rating',rv.rating,'comment',rv.comment,'text',rv.comment,'created_at',rv.created_at,'patient_name',u2.name) order by rv.created_at desc) from reviews rv join users u2 on u2.id=rv.patient_id where rv.clinic_id=c.id),'[]') reviews,
    coalesce((select round(avg(rv.rating)::numeric,1) from reviews rv where rv.clinic_id=c.id),0) rating
    from clinics c join users u on u.id=c.owner_id where c.id=$1`,[id]);
  return r.rows[0]||null;
}
function clinicActive(c){ return c && c.active && c.subscription_status==='active' && c.subscription_expires_at && new Date(c.subscription_expires_at+'T23:59:59')>=new Date(); }
async function notify(userId,title,body=''){ if(userId) await q('insert into notifications(user_id,title,body) values($1,$2,$3)',[userId,title,body]); }

app.get('/api/health',async(req,res)=>{try{await q('select 1');res.json({ok:true,database:true})}catch(e){res.status(503).json({ok:false,database:false,message:'Database unavailable'})}});

app.post('/api/auth/register',async(req,res)=>{
  try{
    const {name,email,phone,password,role:rawRole}=req.body||{}; const roleName=['patient','clinic'].includes(rawRole)?rawRole:'patient';
    if(!name||!email||!password) return res.status(400).json({message:'الاسم والبريد وكلمة المرور مطلوبة'});
    if(password.length<6) return res.status(400).json({message:'كلمة المرور خاصها 6 أحرف على الأقل'});
    const hash=await bcrypt.hash(password,12);
    const r=await q('insert into users(name,email,phone,password_hash,role) values($1,$2,$3,$4,$5) returning *',[name.trim(),email.trim().toLowerCase(),phone||null,hash,roleName]);
    const u=r.rows[0]; const t=tokenFor(u); setAuthCookie(res,t); res.status(201).json({user:safeUser(u),token:t});
  }catch(e){if(e.code==='23505')return res.status(409).json({message:'البريد الإلكتروني مستعمل من قبل'});console.error(e);res.status(500).json({message:'تعذر إنشاء الحساب'});}
});

app.post('/api/auth/login',async(req,res)=>{try{const {email,password}=req.body||{};const r=await q('select * from users where lower(email)=lower($1)',[email||'']);const u=r.rows[0];if(!u||!(await bcrypt.compare(password||'',u.password_hash)))return res.status(401).json({message:'البريد أو كلمة المرور غير صحيحة'}); const t=tokenFor(u); setAuthCookie(res,t); res.json({user:safeUser(u),token:t})}catch(e){console.error(e);res.status(500).json({message:'تعذر تسجيل الدخول'})}});
app.get('/api/me',auth,async(req,res)=>{const u=await userById(req.auth.sub);if(!u)return res.status(404).json({message:'الحساب غير موجود'});res.json(safeUser(u));});

app.post('/api/auth/logout',(req,res)=>{res.clearCookie('sihati_token',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/'});res.json({ok:true});});

app.get('/api/state',auth,async(req,res)=>{
  try{const r=await q('select data from user_app_state where user_id=$1',[req.auth.sub]);res.json(r.rows[0]?.data||{user:{id:req.auth.sub},favorites:[],emergencies:[],mobileVisits:[],messages:[],pharmacies:[],reports:[],payments:[],invoices:[],logs:[]});}
  catch(e){console.error(e);res.status(500).json({message:'تعذر تحميل بيانات الحساب'});}
});
app.put('/api/state',auth,async(req,res)=>{
  try{const allowed=['favorites','emergencies','mobileVisits','messages','pharmacies','reports','payments','invoices','logs'];const data={};for(const k of allowed)data[k]=Array.isArray(req.body?.[k])?req.body[k]:[];data.updated_at=new Date().toISOString();await q(`insert into user_app_state(user_id,data,updated_at) values($1,$2::jsonb,now()) on conflict(user_id) do update set data=excluded.data,updated_at=now()`,[req.auth.sub,JSON.stringify(data)]);res.json({ok:true});}
  catch(e){console.error(e);res.status(500).json({message:'تعذر حفظ البيانات على الخادم'});}
});

app.get('/api/clinics',async(req,res)=>{try{
  const r=await q(`select id from clinics where active=true and subscription_status='active' and subscription_expires_at>=current_date order by verified desc,created_at desc`);
  const rows=[];for(const x of r.rows){const c=await clinicPayload(x.id);rows.push(c)}res.json(rows);
}catch(e){console.error(e);res.status(500).json({message:'تعذر تحميل العيادات'})}});

app.post('/api/clinics',auth,role('clinic'),async(req,res)=>{try{
  const {name,specialty,address,description,lat,lng,schedule}=req.body||{};
  if(!name||!address)return res.status(400).json({message:'اسم العيادة والعنوان مطلوبان'});
  const exists=await q('select id from clinics where owner_id=$1',[req.auth.sub]);if(exists.rows[0])return res.status(409).json({message:'عندك عيادة مسجلة من قبل'});
  const r=await q(`insert into clinics(owner_id,name,specialty,address,description,lat,lng) values($1,$2,$3,$4,$5,$6,$7) returning id`,[req.auth.sub,name,specialty||'',address,description||'',lat||null,lng||null]);
  for(const [day,v] of Object.entries(schedule||{})){await q('insert into working_hours(clinic_id,day_of_week,enabled,from_time,to_time) values($1,$2,$3,$4,$5)',[r.rows[0].id,day,!!v.enabled,v.from||'09:00',v.to||'18:00'])}
  const c=await clinicPayload(r.rows[0].id);res.status(201).json(c);
}catch(e){console.error(e);res.status(500).json({message:'تعذر إنشاء العيادة'})}});

app.get('/api/my/clinic',auth,role('clinic','admin'),async(req,res)=>{try{const r=await q('select id from clinics where owner_id=$1',[req.auth.sub]);if(!r.rows[0])return res.status(404).json({message:'العيادة غير موجودة'});res.json(await clinicPayload(r.rows[0].id))}catch(e){res.status(500).json({message:'تعذر تحميل العيادة'})}});

app.post('/api/clinics/:id/images',auth,role('clinic','admin'),upload.array('images',8),async(req,res)=>{try{
  const c=await q('select * from clinics where id=$1',[req.params.id]);if(!c.rows[0])return res.status(404).json({message:'العيادة غير موجودة'});if(req.auth.role==='clinic'&&c.rows[0].owner_id!==req.auth.sub)return res.status(403).json({message:'ماشي عيادتك'});
  const urls=[];
  for(const f of req.files||[]){let url,pathName;
    if(supabase){pathName=`clinics/${req.params.id}/${Date.now()}-${f.originalname.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const buf=fs.readFileSync(f.path);const up=await supabase.storage.from(bucket).upload(pathName,buf,{contentType:f.mimetype,upsert:false});if(up.error)throw up.error;url=supabase.storage.from(bucket).getPublicUrl(pathName).data.publicUrl;fs.unlinkSync(f.path)}
    else{const target=path.join(uploadDir,`${Date.now()}-${f.filename}${path.extname(f.originalname)}`);fs.renameSync(f.path,target);pathName=path.basename(target);url=`/uploads/${pathName}`;}
    await q('insert into clinic_images(clinic_id,url,path) values($1,$2,$3)',[req.params.id,url,pathName]);urls.push(url);
  }
  res.status(201).json({ok:true,images:urls,clinic:await clinicPayload(req.params.id)});
}catch(e){console.error(e);res.status(500).json({message:'تعذر رفع الصور'})}});

app.get('/api/appointments',auth,async(req,res)=>{try{
  const r=await q(`select a.*,c.name clinic_name,coalesce(d.name,'') doctor_name from appointments a join clinics c on c.id=a.clinic_id left join doctors d on d.id=a.doctor_id where a.patient_id=$1 or c.owner_id=$1 order by a.appointment_date desc,a.appointment_time desc`,[req.auth.sub]);res.json(r.rows);
}catch(e){res.status(500).json({message:'تعذر تحميل المواعيد'})}});

app.post('/api/appointments',auth,role('patient'),async(req,res)=>{try{
  const {clinic_id,doctor_id,appointment_date,appointment_time,service}=req.body||{};if(!clinic_id||!appointment_date||!appointment_time)return res.status(400).json({message:'العيادة والتاريخ والساعة مطلوبة'});
  const cr=await q('select * from clinics where id=$1',[clinic_id]);if(!clinicActive(cr.rows[0]))return res.status(400).json({message:'هاد العيادة غير مفعلة حالياً'});
  const busy=await q(`select id from appointments where clinic_id=$1 and appointment_date=$2 and appointment_time=$3 and status in ('pending','confirmed')`,[clinic_id,appointment_date,appointment_time]);if(busy.rows[0])return res.status(409).json({message:'هاد الموعد محجوز، اختار ساعة أخرى'});
  const r=await q(`insert into appointments(clinic_id,patient_id,doctor_id,appointment_date,appointment_time,service) values($1,$2,$3,$4,$5,$6) returning *`,[clinic_id,req.auth.sub,doctor_id||null,appointment_date,appointment_time,service||'Consultation']);
  await notify(cr.rows[0].owner_id,'موعد جديد',`توصلتي بطلب موعد بتاريخ ${appointment_date} على الساعة ${appointment_time}`);res.status(201).json(r.rows[0]);
}catch(e){console.error(e);res.status(500).json({message:'تعذر إرسال طلب الموعد'})}});

app.patch('/api/appointments/:id/status',auth,async(req,res)=>{try{
  const allowed=['pending','confirmed','completed','cancelled','rejected'];if(!allowed.includes(req.body?.status))return res.status(400).json({message:'حالة غير صالحة'});
  const a=await q(`select a.*,c.owner_id, c.name clinic_name from appointments a join clinics c on c.id=a.clinic_id where a.id=$1`,[req.params.id]);if(!a.rows[0])return res.status(404).json({message:'الموعد غير موجود'});const row=a.rows[0];
  const permitted=req.auth.role==='admin'||(req.auth.role==='clinic'&&row.owner_id===req.auth.sub)||(req.auth.role==='patient'&&row.patient_id===req.auth.sub);if(!permitted)return res.status(403).json({message:'ما عندكش الصلاحية'});
  const r=await q('update appointments set status=$1,updated_at=now() where id=$2 returning *',[req.body.status,req.params.id]);
  const recipient=req.auth.role==='patient'?row.owner_id:row.patient_id;await notify(recipient,'تحديث الموعد',`تم تغيير حالة موعدك إلى: ${req.body.status}`);res.json(r.rows[0]);
}catch(e){res.status(500).json({message:'تعذر تحديث الموعد'})}});

app.post('/api/reviews',auth,role('patient'),async(req,res)=>{try{
  const {appointment_id,rating,comment}=req.body||{};const a=await q(`select * from appointments where id=$1 and patient_id=$2`,[appointment_id,req.auth.sub]);if(!a.rows[0])return res.status(404).json({message:'الموعد غير موجود'});if(a.rows[0].status!=='completed')return res.status(400).json({message:'التقييم متاح بعد إتمام الموعد'});
  const r=await q('insert into reviews(appointment_id,clinic_id,patient_id,rating,comment) values($1,$2,$3,$4,$5) returning *',[appointment_id,a.rows[0].clinic_id,req.auth.sub,Number(rating),comment||'']);const c=await q('select owner_id from clinics where id=$1',[a.rows[0].clinic_id]);await notify(c.rows[0].owner_id,'تقييم جديد','توصلتي بتقييم جديد من أحد المرضى');res.status(201).json(r.rows[0]);
}catch(e){if(e.code==='23505')return res.status(409).json({message:'سبق ليك قيمتي هاد الموعد'});res.status(500).json({message:'تعذر إرسال التقييم'})}});

app.get('/api/notifications',auth,async(req,res)=>{try{const r=await q('select * from notifications where user_id=$1 order by created_at desc limit 100',[req.auth.sub]);res.json(r.rows)}catch(e){res.status(500).json({message:'تعذر تحميل الإشعارات'})}});
app.patch('/api/notifications/:id/read',auth,async(req,res)=>{const r=await q('update notifications set read_at=now() where id=$1 and user_id=$2 returning *',[req.params.id,req.auth.sub]);if(!r.rows[0])return res.status(404).json({message:'الإشعار غير موجود'});res.json(r.rows[0]);});

app.get('/api/admin/clinics',auth,role('admin'),async(req,res)=>{const r=await q('select id from clinics order by created_at desc');const rows=[];for(const x of r.rows)rows.push(await clinicPayload(x.id));res.json(rows)});
app.patch('/api/admin/clinics/:id/activation',auth,role('admin'),async(req,res)=>{const active=!!req.body?.active;const days=Math.max(1,Number(req.body?.days||30));const exp=new Date(Date.now()+days*86400000).toISOString().slice(0,10);const r=await q(`update clinics set active=$1,subscription_status=$2,subscription_expires_at=$3,updated_at=now() where id=$4 returning id`,[active,active?'active':'inactive',active?exp:null,req.params.id]);if(!r.rows[0])return res.status(404).json({message:'العيادة غير موجودة'});res.json(await clinicPayload(req.params.id));});

async function ensureAdmin(){
  if(!process.env.DATABASE_URL||!JWT_SECRET)return;
  const email=(process.env.ADMIN_EMAIL||'admin@sihati.ma').toLowerCase();const password=process.env.ADMIN_PASSWORD||'ChangeThisAdminPassword2026!';
  const r=await q('select id from users where lower(email)=lower($1)',[email]);if(!r.rows[0]){const hash=await bcrypt.hash(password,12);await q('insert into users(name,email,password_hash,role) values($1,$2,$3,$4)', ['SIHATI Admin',email,hash,'admin']);console.log(`Admin created: ${email}`);}
}

app.use('/api',(err,req,res,next)=>{console.error(err);res.status(400).json({message:err.message||'Bad request'})});
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
(async()=>{try{await q('select 1');await ensureAdmin();app.listen(PORT,()=>console.log(`SIHATI Online running on http://localhost:${PORT}`));}catch(e){console.error('Startup failed:',e);process.exit(1)}})();
