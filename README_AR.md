# SIHATI — Online Ready

هذه النسخة كتجمع **Frontend + Node.js API + PostgreSQL/Supabase** في مشروع واحد، باش تقدر تشغل SIHATI Online بدون الاعتماد على localStorage كقاعدة بيانات.

## 1) إعداد Supabase

1. أنشئ مشروع PostgreSQL في Supabase.
2. افتح SQL Editor ونفذ محتوى `database/schema.sql` كاملاً.
3. إذا بغيت صور العيادات تكون دائمة، أنشئ Storage Bucket باسم `sihati-images` وخليه Public، ثم ضع مفاتيح Supabase في `.env`.

## 2) إعداد السيرفر

داخل `server`:

```bash
npm install
copy .env.example .env
```

عدّل `.env`:

- `DATABASE_URL`
- `JWT_SECRET` (64 حرفاً أو أكثر)
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- اختياري للصور: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`

ثم:

```bash
npm start
```

افتح:

`http://localhost:3000`

## 3) الحساب الإداري

في أول تشغيل، يتم إنشاء حساب الإدارة من:

`ADMIN_EMAIL` و `ADMIN_PASSWORD`

**بدّل كلمة المرور الافتراضية قبل النشر.**

## 4) شنو ولى Online؟

- إنشاء الحساب وتسجيل الدخول عبر PostgreSQL.
- JWT authentication.
- العيادات العامة من قاعدة البيانات.
- إنشاء ملف العيادة.
- أوقات العمل.
- صور العيادات.
- المواعيد والحجز.
- تغيير حالة الموعد.
- التقييمات.
- إشعارات الحساب.
- تفعيل العيادات من الإدارة.

## 5) النشر

يمكن نشر مجلد `server` كـ Node.js Web Service. بما أن Express كيقدم Frontend وAPI من نفس السيرفر، ما خاصكش تبدل رابط API في الواجهة.

مثال بعد النشر:

`https://your-domain.com`

والـ API تلقائياً:

`https://your-domain.com/api`

## مهم

النسخة الحالية ما زالت كتحتافظ ببعض الخصائص المحلية القديمة داخل `app.js` كـ fallback/cache. الطبقات الأساسية المذكورة أعلاه أصبحت مرتبطة بالـ API وقاعدة البيانات. إذا بغيتي المرحلة النهائية Production، خاصنا نربط كذلك الإدارة، الدفع الإلكتروني، الرسائل/OTP، والطبيب المتنقل والحالات المستعجلة مباشرة بالـ API بدل localStorage.
