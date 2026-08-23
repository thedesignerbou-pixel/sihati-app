/* SIHATI ONLINE — API-only connection layer.
   Application data is loaded from Node.js/PostgreSQL. localStorage is not used as a database.
*/
(() => {
  const defaultApi = `${location.origin}/api`;
  const API = (window.SIHATI_API_URL || defaultApi).replace(/\/$/, '');
  let token = '';
  let apiOnline = false;
  window.SIHATI_API = API;
  window.sihatiApiOnline = () => apiOnline;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch(`${API}${path}`, { ...options, headers, credentials:'include' });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  function setSession(user, newToken) {
    token = newToken || '';
    current = user ? { id:user.id, name:user.name, email:user.email, phone:user.phone||'', type:user.role==='clinic'?'clinic':user.role, favorites:current?.favorites||[] } : null;
  }

  function mapClinic(c) {
    const schedule = {};
    const names = {mon:'mon',tue:'tue',wed:'wed',thu:'thu',fri:'fri',sat:'sat',sun:'sun'};
    (c.working_hours || []).forEach(w => { schedule[names[w.day_of_week] || w.day_of_week] = { enabled:!!w.enabled, from:String(w.from_time||'09:00').slice(0,5), to:String(w.to_time||'18:00').slice(0,5) }; });
    const reviews = c.reviews || [];
    return {
      id:c.id, ownerId:c.owner_id, name:c.name, specialty:c.specialty||'', address:c.address||'', description:c.description||'', doctor:c.doctor||'',
      images:(c.images||[]).map(x=>typeof x==='string'?x:(x.url?.startsWith('http')?x.url:`${API.replace('/api','')}${x.url||''}`)),
      location:{lat:c.lat==null?null:+c.lat,lng:c.lng==null?null:+c.lng}, schedule, doctors:c.doctors||[], services:c.services||[], verified:!!c.verified,
      rating:Number(c.rating||0), reviews, status:c.active?'active':'pending', subscription:{active:c.subscription_status==='active',expires:c.subscription_expires_at?String(c.subscription_expires_at).slice(0,10):null,plan:'monthly',price:99},
      api:true
    };
  }

  async function syncPublicClinics() {
    try {
      const arr = await api('/clinics');
      const mapped = arr.map(mapClinic);
      db.clinics = mapped.concat(db.clinics.filter(c => !c.api));
      db.clinics.forEach(ensureClinicData); save(); apiOnline=true; return mapped;
    } catch (e) { apiOnline=false; console.warn('SIHATI API offline:',e.message); return null; }
  }

  async function syncMyClinic() {
    if (!token || current?.type!=='clinic') return null;
    try {
      const c = mapClinic(await api('/my/clinic'));
      const i=db.clinics.findIndex(x=>x.api&&x.id===c.id || x.ownerId===current.id);
      if(i>=0) db.clinics[i]=c; else db.clinics.push(c);
      save(); return c;
    } catch(e) { console.warn('Clinic sync:',e.message); return null; }
  }

  async function syncAppointments() {
    if (!token) return;
    try {
      const rows=await api('/appointments');
      db.appointments=rows.map(a=>({id:a.id,clinicId:a.clinic_id,userId:a.patient_id,date:String(a.appointment_date).slice(0,10),time:String(a.appointment_time).slice(0,5),type:a.service||'Consultation',status:a.status==='cancelled'?'cancelled':a.status,note:'',doctorId:a.doctor_id,createdAt:a.created_at,clinicName:a.clinic_name,doctorName:a.doctor_name,api:true}));
      save();
    } catch(e) { console.warn('Appointment sync:',e.message); }
  }

  async function syncNotifications() {
    if(!token) return;
    try {
      const rows=await api('/notifications');
      db.notifications=rows.map(n=>({id:n.id,userId:n.user_id,text:`${n.title}${n.body?': '+n.body:''}`,read:!!n.read_at,date:n.created_at,type:'api'})); save();
    } catch(e) { console.warn('Notification sync:',e.message); }
  }

  const originalLogin = window.login;
  window.login = async function(e) {
    e.preventDefault();
    if (!apiOnline) { return toast('الخادم غير متاح حالياً. عاود المحاولة بعد قليل.'); }
    try {
      const data=await api('/auth/login',{method:'POST',body:JSON.stringify({email:aLogin.value,password:aPass.value})});
      setSession(data.user,data.token); await syncState(); closeModal(); toast(`مرحبا ${data.user.name}`); await Promise.all([syncPublicClinics(),syncMyClinic(),syncAppointments(),syncNotifications()]); showScreen(data.user.role==='admin'?'admin':data.user.role==='clinic'?'clinicDashboard':'home');
    } catch(err) { toast(err.message||'بيانات الدخول غير صحيحة'); }
  };

  const originalRegister = window.register;
  window.register = async function(e) {
    e.preventDefault();
    if (!apiOnline) return toast('الخادم غير متاح حالياً. عاود المحاولة بعد قليل.');
    try {
      const data=await api('/auth/register',{method:'POST',body:JSON.stringify({name:rName.value,email:rEmail.value,phone:rPhone.value,password:rPass.value,role:registerType})});
      setSession(data.user,data.token); await syncState();
      if(registerType==='clinic') {
        const schedule={}; days.forEach(([k])=>schedule[k]={day_of_week:k,enabled:document.getElementById('ce_'+k).checked,from:document.getElementById('cf_'+k).value,to:document.getElementById('ct_'+k).value});
        const c=mapClinic(await api('/clinics',{method:'POST',body:JSON.stringify({name:cName.value,specialty:cSpec.value,address:cAddress.value,description:cDesc.value,lat:+cLat.value||null,lng:+cLng.value||null,schedule})}));
        const files=[...(document.getElementById('cImages')?.files||[])];
        if(files.length){const fd=new FormData();files.forEach(f=>fd.append('images',f));await api(`/clinics/${c.id}/images`,{method:'POST',body:fd});}
        db.clinics.push(c); save(); closeModal(); toast('تم إنشاء حساب العيادة. أتمم الاشتراك من لوحة العيادة.'); showScreen('clinicDashboard');
      } else { closeModal(); toast('تم إنشاء الحساب'); showScreen('home'); }
    } catch(err) {
      toast(String(err?.message || 'تعذر إنشاء الحساب'));
    }
  };

  window.logout = async function(){ try{await api('/auth/logout',{method:'POST'});}catch{} token=''; current=null; remoteHydrated=false; closeDrawer(); toast('تم تسجيل الخروج'); showScreen('home'); };

  const originalAdminLogin=window.adminLogin;
  window.adminLogin=async function(e){
    e.preventDefault();
    if(!apiOnline) return originalAdminLogin(e);
    try { const data=await api('/auth/login',{method:'POST',body:JSON.stringify({email:adEmail.value,password:adPass.value})}); if(data.user.role!=='admin')throw new Error('هذا الحساب ليس حساب إدارة'); setSession(data.user,data.token); await syncState(); closeModal(); screen='admin'; render(); } catch(err){toast(err.message||'بيانات الإدارة غير صحيحة');}
  };

  const originalConfirmBooking=window.confirmBooking;
  window.confirmBooking=async function(e){
    e.preventDefault(); if(!apiOnline)return toast('الخادم غير متاح حالياً. عاود المحاولة بعد قليل.'); if(!current||current.type!=='patient')return openAuth('login'); if(!bookingDate||!bookingTime)return toast('اختار اليوم والساعة');
    try { await api('/appointments',{method:'POST',body:JSON.stringify({clinic_id:selectedClinic.id,doctor_id:document.getElementById('bDoctor')?.value||null,appointment_date:bookingDate,appointment_time:bookingTime,service:document.getElementById('bType')?.value||'Consultation'})}); await syncAppointments(); await syncNotifications(); closeModal(); toast('تم إرسال طلب الموعد'); showScreen('appointments'); } catch(err){toast(err.message||'تعذر إرسال الموعد');}
  };

  const originalSetStatus=window.setAppointmentStatus;
  window.setAppointmentStatus=async function(id,status){
    if(!apiOnline)return toast('الخادم غير متاح حالياً. عاود المحاولة بعد قليل.');
    try{await api(`/appointments/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});await syncAppointments();await syncNotifications();renderAppointments();toast('تم تحديث الموعد');}catch(err){toast(err.message||'تعذر تحديث الموعد');}
  };

  const originalSubmitReview=window.submitReview;
  window.submitReview=async function(e,id){
    e.preventDefault(); if(!apiOnline)return toast('الخادم غير متاح حالياً. عاود المحاولة بعد قليل.');
    try{await api('/reviews',{method:'POST',body:JSON.stringify({appointment_id:id,rating:+revRating.value,comment:revText.value.trim()})});await syncPublicClinics();await syncNotifications();closeModal();toast('شكراً على تقييمك ⭐');}catch(err){toast(err.message||'تعذر إرسال التقييم');}
  };

  const originalRender=window.render;
  let syncing=false;
  window.render=originalRender;

  const privateStateKeys=['favorites','emergencies','mobileVisits','messages','pharmacies','reports','payments','invoices','logs'];
  function applyRemoteState(state){
    if(!state) return;
    for(const k of privateStateKeys){ if(Array.isArray(state[k])) db[k]=state[k]; }
    if(state.user){ current={...current,...state.user}; }
    remoteHydrated=true;
  }
  let persistTimer=null;
  window.sihatiPersistState=async function(){
    if(!remoteHydrated || !token) return;
    clearTimeout(persistTimer);
    persistTimer=setTimeout(async()=>{
      try{
        const payload={};
        for(const k of privateStateKeys) payload[k]=Array.isArray(db[k])?db[k]:[];
        await api('/state',{method:'PUT',body:JSON.stringify(payload)});
      }catch(e){ console.warn('Remote state save failed:',e.message); }
    },250);
  };
  async function syncState(){
    if(!token) return;
    try{ applyRemoteState(await api('/state')); }catch(e){ console.warn('Remote state load failed:',e.message); }
  }

  async function boot(){
    try { await api('/health'); apiOnline=true; } catch { apiOnline=false; }
    if(apiOnline){
      try {
        if(token){ const me=await api('/me'); setSession(me,token); await syncState(); }
        await syncPublicClinics();
        if(token){ await syncMyClinic(); await syncAppointments(); await syncNotifications(); }
      } catch(e){console.warn(e);}
    }
    if(typeof render==='function') render();
  }

  // Refresh real data when the user enters relevant screens.
  const baseShowScreen=window.showScreen;
  window.showScreen=async function(s){
    baseShowScreen(s);
    if(!apiOnline||syncing)return;
    syncing=true;
    try{
      if(s==='home'||s==='search')await syncPublicClinics();
      if(s==='appointments')await syncAppointments();
      if(s==='notifications')await syncNotifications();
      if(s==='clinicDashboard')await syncMyClinic();
    }finally{syncing=false; if(typeof render==='function')render();}
  };

  // Public clinic images are served by the API host, not the frontend host.
  window.SIHATI_API_ROOT=API.replace(/\/api$/,'');
  boot();
})();
