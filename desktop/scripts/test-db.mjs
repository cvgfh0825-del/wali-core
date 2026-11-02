// اختبار الداتا بيز على PGlite (Postgres حقيقي) — بيشغّل نفس ملفات Supabase
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const mig = (f) => readFileSync(path.join(here, '../../supabase/migrations', f), 'utf8')
const db = new PGlite()
await db.exec(readFileSync(path.join(here, '../src/demo/bootstrap.sql'), 'utf8'))
for (const f of ['0001_core.sql', '0002_logic.sql', '0003_security_notify.sql', '0005_returns.sql', '0006_backup.sql', '0007_product_images.sql', '0008_fusha_messages.sql', '0010_check_in_fix.sql']) {
  try { await db.exec(mig(f)); console.log('✔', f) }
  catch (e) { console.error('✘', f, e.message, e.position ?? ''); process.exit(1) }
}

const as = async (uid) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
let fails = 0
const ok = (cond, msg) => { console.log(cond ? '  ✔' : '  ✘', msg); if (!cond) fails++ }
const expectErr = async (fn, msg) => {
  try { await fn(); ok(false, msg + ' (كان المفروض يرفض)') } catch (e) { ok(true, msg + ' ← ' + e.message) }
}

// مستخدمين: أول واحد Admin
const admin = (await one(`insert into auth.users(email, raw_user_meta_data) values ('admin@wali.local', '{"username":"admin","full_name":"المدير"}') returning id`)).id
const seller = (await one(`insert into auth.users(email, raw_user_meta_data) values ('sara@wali.local', '{"username":"sara","full_name":"سارة"}') returning id`)).id
ok((await one(`select role from profiles where id=$1`, [admin])).role === 'admin', 'أول مستخدم بقى Admin')
ok((await one(`select role from profiles where id=$1`, [seller])).role === 'custom', 'التاني مش Admin')

await as(admin)
await db.query(`update profiles set permissions = '{"sales":["view","create"],"products":["view"],"customers":["view","create"]}' where id=$1`, [seller])
await expectErr(() => one(`select save_invoice($1)`, [{ kind: 'final', items: [] }]), 'فاتورة من غير ريت')
await one(`select set_exchange_rate(2500)`)
ok(Number((await one(`select current_rate() r`)).r) === 2500, 'ريت النهارده 2500')

const cat = (await one(`select id from categories limit 1`)).id
const p1 = (await one(`insert into products(code, barcode, name, model, category_id, margin_pct, min_qty) values ('1001','6221001','مكتب رئاسي','EX-01',$1,30,2) returning id`, [cat])).id
const p2 = (await one(`insert into products(code, name, model, margin_pct) values ('2001','كرسي جلد','CH-7',25) returning id`)).id
await one(`select adjust_stock($1, 1, 'رصيد أول', true)`, [p1])

// مشتريات: 10 مكاتب × 400$ و 20 كرسي × 50$ + شحن وجمارك
const sup = (await one(`insert into suppliers(name, country) values ('مصنع الصين','الصين') returning id`)).id
const pur = await one(`select * from save_purchase($1)`, [{
  supplier_id: sup, shipping_sdg: 1250000, customs_sdg: 1250000, other_sdg: 0, paid_sdg: 5000000,
  items: [{ product_id: p1, qty: 10, unit_price_usd: 400 }, { product_id: p2, qty: 20, unit_price_usd: 50 }] }])
// البضاعة 5000$، المصاريف 2,500,000 ج = 1000$ → معامل 20% → المكتب 480$
// المكتب الافتتاحي تكلفته 0 → المتوسط = (1×0 + 10×480) / 11
const pr1 = await one(`select * from v_products where id=$1`, [p1])
ok(Number(pr1.qty_on_hand) === 11, 'المخزن: 11 مكتب (1 افتتاحي + 10)')
ok(Math.abs(Number(pr1.cost_usd) - 4800 / 11) < 0.01, 'متوسط تكلفة المكتب بعد الشحن والجمارك = ' + pr1.cost_usd + '$')
ok(Number(pr1.price_usd) === Math.round(Number(pr1.cost_usd) * 1.3 * 100) / 100, 'سعر البيع = التكلفة + 30% = ' + pr1.price_usd + '$')
ok(Number(pr1.price_sdg) === Math.round(Number(pr1.price_usd) * 2500 * 100) / 100, 'السعر بالجنيه = ' + pr1.price_sdg)
ok(Number(pur.paid_sdg) === 5000000, 'المدفوع للمورد اتسجل')
const pr2a = await one(`select cost_usd from products where id=$1`, [p2])
ok(Math.abs(Number(pr2a.cost_usd) - 60) < 0.01, 'تكلفة الكرسي 50$ + 20% مصاريف = ' + pr2a.cost_usd)

// فاتورة مبدئية من يوزر المعرض
await as(seller)
const pf = await one(`select * from save_invoice($1)`, [{ kind: 'proforma', customer_name: 'شركة النيل', customer_phone: '0911', items: [{ product_id: p1, qty: 2 }, { product_id: p2, qty: 4 }] }])
ok(pf.number.startsWith('PF-'), 'رقم المبدئية ' + pf.number)
await expectErr(() => one(`select set_exchange_rate(3000)`), 'سارة متقدرش تغير الريت')
await expectErr(() => one(`select cancel_invoice($1,'x')`, [pf.id]), 'سارة متقدرش تلغي')
ok(Number((await one(`select count(*) c from notifications where title like 'فاتورة مبدئية%'`)).c) === 1, 'إشعار المبدئية وصل للأدمن')
const resv = await one(`select reserved_qty from v_products where id=$1`, [p1])
ok(Number(resv.reserved_qty) === 2, 'المحجوز في المبدئيات = 2')

// الريت اتغير → التحويل بالريت الجديد
await as(admin)
await one(`select set_exchange_rate(2600)`)
const fin = await one(`select * from convert_proforma($1, 1000000)`, [pf.id])
ok(fin.kind === 'final' && fin.status === 'posted', 'المبدئية اتحولت لنهائية ' + fin.number)
ok(Number(fin.rate) === 2600, 'النهائية بريت 2600')
ok(fin.payment_type === 'partial' && Number(fin.paid_sdg) === 1000000, 'دفع جزئي 1,000,000')
ok((await one(`select status from invoices where id=$1`, [pf.id])).status === 'converted', 'المبدئية بقت converted')
const pr1b = await one(`select qty_on_hand, sold_qty, total_in from v_products where id=$1`, [p1])
ok(Number(pr1b.qty_on_hand) === 9 && Number(pr1b.sold_qty) === 2 && Number(pr1b.total_in) === 11, 'المخزن: الكلي 11، المباع 2، الباقي 9')
await expectErr(() => one(`select convert_proforma($1)`, [pf.id]), 'متتحولش مرتين')
await expectErr(() => one(`select save_invoice($1)`, [{ kind: 'final', customer_name: 'x', items: [{ product_id: p1, qty: 50 }] }]), 'مينفعش يتباع أكتر من المخزن')
await expectErr(() => one(`select save_invoice($1)`, [{ kind: 'final', items: [{ product_id: p1, qty: 1 }], paid_sdg: 0 }]), 'آجل من غير عميل')

// إذن تسليم
const dp = await one(`select * from create_delivery_permit($1)`, [fin.id])
await expectErr(() => one(`select create_delivery_permit($1)`, [fin.id]), 'متطلعش إذن مرتين لنفس البضاعة')
await one(`select confirm_delivery($1)`, [dp.id])
ok(Number((await one(`select withdrawn_qty from v_products where id=$1`, [p1])).withdrawn_qty) === 2, 'المسحوب (المتسلّم) = 2')

// تحصيل باقي الفاتورة
await expectErr(() => one(`select record_payment($1)`, [{ direction: 'in', party_type: 'customer', invoice_id: fin.id, amount_sdg: 99999999999 }]), 'تحصيل أكتر من الباقي')
await one(`select record_payment($1)`, [{ direction: 'in', party_type: 'customer', invoice_id: fin.id, amount_sdg: Number(fin.total_sdg) - 1000000 }])
ok((await one(`select payment_type from invoices where id=$1`, [fin.id])).payment_type === 'cash', 'الفاتورة اتقفلت بعد التحصيل')

// إلغاء فاتورة نهائية بيرجّع المخزن والفلوس
const f2 = await one(`select * from save_invoice($1)`, [{ kind: 'final', items: [{ product_id: p2, qty: 3 }], paid_sdg: 999999999 }])
ok(Number(f2.paid_sdg) === Number(f2.total_sdg), 'الدفع اتظبط على إجمالي الفاتورة')
await one(`select cancel_invoice($1, 'العميل رجع')`, [f2.id])
ok(Number((await one(`select qty_on_hand from products where id=$1`, [p2])).qty_on_hand) === 16, 'بعد الإلغاء المخزن رجع 16 كرسي')
ok(Number((await one(`select paid_sdg from invoices where id=$1`, [f2.id])).paid_sdg) === 0, 'الفلوس اترجعت')

// مرتجع جزئي: 4 كراسي بخصم، ومدفوعة كاملة → يرجع كرسي واحد
const f3 = await one(`select * from save_invoice($1)`, [{ kind: 'final', customer_name: 'عميل مرتجع', discount_sdg: 20000, items: [{ product_id: p2, qty: 4 }], paid_sdg: 999999999 }])
const f3item = await one(`select * from invoice_items where invoice_id=$1`, [f3.id])
const ret = await one(`select * from create_sales_return($1, $2, 'كرسي مكسور')`, [f3.id, JSON.stringify([{ invoice_item_id: f3item.id, qty: 1 }])])
const expRet = Number(f3item.unit_price_sdg) - Math.round(20000 * Number(f3item.unit_price_sdg) / Number(f3.subtotal_sdg) * 100) / 100
ok(ret.number.startsWith('RT-') && Math.abs(Number(ret.total_sdg) - expRet) < 0.02, `مرتجع ${ret.number} بقيمة ${ret.total_sdg} (بعد نصيبه من الخصم)`)
ok(Number((await one(`select qty_on_hand from products where id=$1`, [p2])).qty_on_hand) === 13, 'الكرسي رجع المخزن (13)')
ok(Math.abs(Number(ret.refund_sdg) - Number(ret.total_sdg)) < 0.02, 'الفلوس اترجعت للعميل = ' + ret.refund_sdg)
const f3v = await one(`select remaining_sdg, paid_sdg from v_invoices where id=$1`, [f3.id])
ok(Math.abs(Number(f3v.remaining_sdg)) < 0.02, 'الفاتورة مفيهاش متبقي بعد المرتجع')
ok(Number((await one(`select sold_qty from v_products where id=$1`, [p2])).sold_qty) === 7, 'المباع من الكراسي = 4 (الفاتورة الأولى) + 3')
await expectErr(() => one(`select create_sales_return($1, $2, 'x')`, [f3.id, JSON.stringify([{ invoice_item_id: f3item.id, qty: 4 }])]), 'مينفعش يرجع أكتر من الباقي')
await expectErr(() => one(`select cancel_invoice($1, 'x')`, [f3.id]), 'فاتورة عليها مرتجع متتلغيش')
ok(Number((await one(`select count(*) c from notifications where title like 'مرتجع%'`)).c) === 1, 'إشعار المرتجع وصل للأدمن')
await as(seller)
await expectErr(() => one(`select create_sales_return($1, $2, 'x')`, [f3.id, JSON.stringify([{ invoice_item_id: f3item.id, qty: 1 }])]), 'سارة متقدرش تعمل مرتجع')
await as(admin)

// إلغاء مشتريات: 5 كراسي × 50$ → المخزن والتكلفة يرجعوا زي ما كانوا
const cost0 = Number((await one(`select cost_usd from products where id=$1`, [p2])).cost_usd)
const pur2 = await one(`select * from save_purchase($1)`, [{ supplier_id: sup, paid_sdg: 100000, items: [{ product_id: p2, qty: 5, unit_price_usd: 50 }] }])
ok(Number((await one(`select qty_on_hand from products where id=$1`, [p2])).qty_on_hand) === 18, 'المشتريات دخلت (18)')
const pc = await one(`select * from cancel_purchase($1, 'غلط في الكمية')`, [pur2.id])
const p2c = await one(`select qty_on_hand, cost_usd from products where id=$1`, [p2])
ok(pc.status === 'cancelled' && Number(p2c.qty_on_hand) === 13, 'المشتريات اتلغت والمخزن رجع 13')
ok(Math.abs(Number(p2c.cost_usd) - cost0) < 0.01, `التكلفة رجعت ${p2c.cost_usd}$`)
ok(Number(pc.paid_sdg) === 0, 'المدفوع للمورد اتسجل استرداد')
await expectErr(() => one(`select cancel_purchase($1, 'x')`, [pur.id]), 'مشتريات اتباع منها متتلغيش')
await expectErr(() => one(`select cancel_purchase($1, 'x')`, [pur2.id]), 'متتلغيش مرتين')

// تسوية ونقص مخزون
await one(`select adjust_stock($1, 1, 'جرد')`, [p1])
ok(Number((await one(`select count(*) c from notifications where title like 'انخفاض المخزون%'`)).c) >= 1, 'إشعار نقص المخزون')
await db.query(`update products set qty_on_hand = 999 where id=$1`, [p1])
ok(Number((await one(`select qty_on_hand from products where id=$1`, [p1])).qty_on_hand) === 1, 'الكمية متتعدلش مباشرة')

// موظفين وحضور ومرتبات
const emp = (await one(`insert into employees(user_id, full_name, base_salary, commission_pct, commission_basis) values ($1,'سارة',300000,2,'own') returning id`, [seller])).id
await one(`insert into employees(full_name, base_salary) values ('عامل مخزن', 200000) returning id`)
// الأدمن عدّل حضور النهارده قبل ما الموظف يسجل → سجل من غير وقت حضور
const day = (await one(`select local_today()::text d`)).d
await one(`select admin_set_attendance($1::jsonb)`, [JSON.stringify({ employee_id: emp, work_date: day, status: 'present', note: '' })])
await as(seller)
ok(!!(await one(`select check_in() a`)).a, 'الحضور بيتسجل حتى لو الأدمن عمل سجل لليوم من غير وقت')
await expectErr(() => one(`select check_in()`), 'متسجلش حضور مرتين')
await one(`select check_out()`)
await as(admin)
await one(`insert into salary_advances(employee_id, amount_sdg) values ($1, 50000) returning id`, [emp])
await one(`insert into salary_deductions(employee_id, amount_sdg, reason) values ($1, 10000, 'غياب') returning id`, [emp])
const period = (await one(`select to_char(local_today(),'YYYY-MM') p`)).p
await one(`select generate_payroll($1)`, [period])
const pay = await one(`select * from payrolls where employee_id=$1`, [emp])
const expectedComm = Math.round(Number(fin.total_sdg) * 0.02 * 100) / 100
ok(Math.abs(Number(pay.commission) - expectedComm) < 0.02, 'عمولة سارة 2% من مبيعاتها = ' + pay.commission)
ok(Math.abs(Number(pay.net) - (300000 + Number(pay.commission) - 10000 - 50000 - Number(pay.late_deduction))) < 0.02, 'صافي المرتب = ' + pay.net)
await one(`select pay_payroll($1)`, [pay.id])
ok(Number((await one(`select count(*) c from expenses where ref_type='payroll'`)).c) === 1, 'المرتب اتسجل مصروف')
await expectErr(() => one(`select pay_payroll($1)`, [pay.id]), 'المرتب ميتصرفش مرتين')

// مساهمين
const sh = (await one(`insert into shareholders(full_name, joined_at) values ('الشريك الأول', local_today() - 40) returning id`)).id
await one(`insert into shareholder_terms(shareholder_id, effective_from, monthly_salary, sales_pct, profit_pct) values ($1, local_today() - 40, 500000, 1, 40) returning id`, [sh])
await one(`select generate_shareholder_payouts($1)`, [period])
const sp = await one(`select * from shareholder_payouts where shareholder_id=$1`, [sh])
ok(Math.abs(Number(sp.total) - (500000 + Math.round(Number(sp.sales_base) * 0.01 * 100) / 100)) < 0.02, 'مستحقات المساهم = ' + sp.total)
await one(`select pay_shareholder_payout($1)`, [sp.id])
await one(`insert into expenses(category_id, amount_sdg, description) select id, 100000, 'تبرع' from expense_categories where kind='social' returning id`)
const year = Number((await one(`select extract(year from local_today())::int y`)).y)
const rep = (await one(`select annual_report($1) r`, [year])).r
ok(Math.abs(rep.net_profit - (rep.sales - rep.cogs - rep.expenses)) < 0.02, 'صافي الربح السنوي = ' + rep.net_profit)
ok(rep.shareholders.length === 1 && Math.abs(rep.shareholders[0].received - Number(sp.total)) < 0.02,
   'تقرير المساهم: استلم ' + rep.shareholders[0].received + ' — نصيبه من الربح ' + rep.shareholders[0].profit_share)

const dash = (await one(`select dashboard(local_today() - 30, local_today()) d`)).d
ok(dash.sales > 0 && dash.open_proformas === 0, 'لوحة التحكم شغالة — مبيعات ' + dash.sales)

// لوحة التحكم لموظف المعرض: مبيعاته بس ومن غير أرقام الربح
await as(seller)
const sdash = (await one(`select dashboard(local_today() - 30, local_today()) d`)).d
ok(sdash.limited === true && sdash.cogs === undefined && sdash.stock_value_sdg === undefined, 'سارة مش شايفة الربح وقيمة المخزون')
ok(Math.abs(sdash.sales - Number(fin.total_sdg)) < 0.02, 'سارة شايفة مبيعاتها هي بس = ' + sdash.sales)
await as(admin)

// صلاحيات: محدش يقدر يرقّي نفسه
await as(seller)
await db.query(`update profiles set role='admin' where id=$1`, [seller])
ok((await one(`select role from profiles where id=$1`, [seller])).role === 'custom', 'سارة متقدرش تخلي نفسها Admin')

// نسخة احتياطية واسترجاع
await expectErr(() => one(`select export_backup()`), 'سارة متقدرش تاخد نسخة')
await as(admin)
const bk = (await one(`select export_backup() b`)).b
const snap = async () => one(`select (select count(*) from invoices) i, (select count(*) from stock_movements) m,
  (select qty_on_hand from products where id=$1) q, (select count(*) from sales_returns) r`, [p2])
const before = await snap()
ok(bk.tables.invoices.length === Number(before.i) && bk.tables.profiles.length === 2, `النسخة فيها ${bk.tables.invoices.length} فاتورة`)
await one(`select save_invoice($1)`, [{ kind: 'final', items: [{ product_id: p2, qty: 2 }], paid_sdg: 999999999 }])
const counts = (await one(`select restore_backup($1) c`, [JSON.stringify(bk)])).c
const after = await snap()
ok(JSON.stringify(after) === JSON.stringify(before), `بعد الاسترجاع كل حاجة رجعت زي ما كانت (المخزن ${after.q})`)
ok(Number((await one(`select count(*) c from profiles`)).c) === 2, 'المستخدمين متلمسوش')
ok(Number((await one(`select count(*) c from notifications where type='backup.restore'`)).c) === 1, 'إشعار الاسترجاع وصل للأدمن')
// نسخة قديمة ناقصها أعمدة اتضافت بعدين → بتاخد القيمة الافتراضية
const old = JSON.parse(JSON.stringify(bk))
old.tables.invoice_items.forEach((r) => delete r.returned_qty)
await one(`select restore_backup($1)`, [JSON.stringify(old)])
ok(Number((await one(`select count(*) c from invoice_items where returned_qty = 0`)).c) > 0, 'نسخة قديمة اتسترجعت عادي')
await expectErr(() => one(`select restore_backup($1)`, [JSON.stringify({ app: 'x', tables: {} })]), 'ملف غلط ميتسترجعش')
const ret2 = await one(`select count(*) c from sales_returns`)
ok(Number(ret2.c) === 1 && counts.sales_returns === 1, 'المرتجعات رجعت مع النسخة')

// صور الأصناف: في جدول لوحدها، والقايمة فيها رقم النسخة بس
const img = 'data:image/jpeg;base64,' + 'A'.repeat(30000)
const notifBefore = Number((await one(`select count(*) c from notifications`)).c)
ok(Number((await one(`select set_product_image($1, $2) v`, [p1, img])).v) === 1, 'الصورة اتحفظت (نسخة 1)')
ok(Number((await one(`select count(*) c from notifications`)).c) === notifBefore, 'تغيير الصورة بس مبيطلّعش إشعار')
const vp = await one(`select * from v_products where id=$1`, [p1])
ok(!('image' in vp) && vp.image_v === 1, 'قايمة الأصناف مفيهاش الصورة نفسها')
ok((await one(`select image from product_images where product_id=$1`, [p1])).image === img, 'الصورة في جدولها')
await one(`select set_product_image($1, null)`, [p1])
ok(Number((await one(`select count(*) c from product_images`)).c) === 0 && Number((await one(`select image_v from products where id=$1`, [p1])).image_v) === 2, 'شيل الصورة')
await expectErr(() => one(`select set_product_image($1, $2)`, [p1, 'x'.repeat(500000)]), 'صورة كبيرة جداً مترفضش')
await as(seller)
await expectErr(() => one(`select set_product_image($1, $2)`, [p1, img]), 'سارة متقدرش تغيّر الصور')
await as(admin)
// نسخة قديمة كانت الصورة فيها جوه الصنف
const legacy = JSON.parse(JSON.stringify(bk))
delete legacy.tables.product_images
legacy.tables.products.forEach((r) => { r.image = r.id === p2 ? img : null; delete r.image_v })
await one(`select restore_backup($1)`, [JSON.stringify(legacy)])
const lp = await one(`select image_v, (select image from product_images where product_id = p.id) image from products p where id=$1`, [p2])
ok(lp.image_v === 1 && lp.image === img, 'صور النسخ القديمة اتنقلت لجدول الصور')

const notes = await one(`select count(*) c from notifications`)
const audit = await one(`select count(*) c from audit_log`)
console.log(`\nإشعارات: ${notes.c} — سجل تدقيق: ${audit.c}`)
console.log(fails ? `\n✘ ${fails} اختبار فشل` : '\n✔ كل الاختبارات نجحت')
process.exit(fails ? 1 : 0)
