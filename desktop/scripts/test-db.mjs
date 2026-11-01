// اختبار الداتا بيز على PGlite (Postgres حقيقي) — بيشغّل نفس ملفات Supabase
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const mig = (f) => readFileSync(path.join(here, '../../supabase/migrations', f), 'utf8')
const db = new PGlite()
await db.exec(readFileSync(path.join(here, '../src/demo/bootstrap.sql'), 'utf8'))
for (const f of ['0001_core.sql', '0002_logic.sql', '0003_security_notify.sql']) {
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

// تسوية ونقص مخزون
await one(`select adjust_stock($1, 1, 'جرد')`, [p1])
ok(Number((await one(`select count(*) c from notifications where title like 'نقص مخزون%'`)).c) >= 1, 'إشعار نقص المخزون')
await db.query(`update products set qty_on_hand = 999 where id=$1`, [p1])
ok(Number((await one(`select qty_on_hand from products where id=$1`, [p1])).qty_on_hand) === 1, 'الكمية متتعدلش مباشرة')

// موظفين وحضور ومرتبات
const emp = (await one(`insert into employees(user_id, full_name, base_salary, commission_pct, commission_basis) values ($1,'سارة',300000,2,'own') returning id`, [seller])).id
await one(`insert into employees(full_name, base_salary) values ('عامل مخزن', 200000) returning id`)
await as(seller)
await one(`select check_in()`)
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

const notes = await one(`select count(*) c from notifications`)
const audit = await one(`select count(*) c from audit_log`)
console.log(`\nإشعارات: ${notes.c} — سجل تدقيق: ${audit.c}`)
console.log(fails ? `\n✘ ${fails} اختبار فشل` : '\n✔ كل الاختبارات نجحت')
process.exit(fails ? 1 : 0)
