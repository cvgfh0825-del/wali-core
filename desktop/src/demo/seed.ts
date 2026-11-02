// بيانات تجريبية لوالي بلازا — بتتعمل مرة واحدة أول ما وضع التجربة يفتح
import bootstrap from './bootstrap.sql?raw'
import m1 from '../../../supabase/migrations/0001_core.sql?raw'
import m2 from '../../../supabase/migrations/0002_logic.sql?raw'
import m3 from '../../../supabase/migrations/0003_security_notify.sql?raw'
import m5 from '../../../supabase/migrations/0005_returns.sql?raw'
import m6 from '../../../supabase/migrations/0006_backup.sql?raw'
import m7 from '../../../supabase/migrations/0007_product_images.sql?raw'
import m8 from '../../../supabase/migrations/0008_fusha_messages.sql?raw'
import m10 from '../../../supabase/migrations/0010_check_in_fix.sql?raw'

// نسخة تجربة قديمة محفوظة في الجهاز → نضيفلها التحديثات الجديدة
export async function upgradeDemo(db: any) {
  const r = await db.query(`select to_regclass('public.sales_returns') is not null as m5,
                                   to_regclass('public.product_images') is not null as m7,
                                   exists (select 1 from pg_proc where proname = 'check_out' and prosrc like '%لا يوجد حضور%') as m8,
                                   exists (select 1 from pg_proc where proname = 'check_in' and prosrc like '%do update%') as m10`)
  const { m5: has5, m7: has7, m8: has8, m10: has10 } = r.rows[0]
  if (has10) return false
  if (has8) { await db.exec(m10); return true }
  if (!has7) {
    await db.exec(m3)
    if (!has5) await db.exec(m5)
    await db.exec(m6)
    await db.exec(m7)
  }
  await db.exec(m8)
  await db.exec(m10)
  return true
}

const PRODUCTS: [string, string, string, string, number, number, number][] = [
  // كود، اسم، موديل، القسم، سعر الشراء $، نسبة الربح، الكمية
  ['1001', 'مكتب رئاسي فاخر بجناح جانبي', 'EX-LUX 240', 'مكاتب رئاسية', 1450, 35, 4],
  ['1002', 'مكتب رئاسي خشب جوز ورخام', 'EX-MRB 220', 'مكاتب رئاسية', 1780, 35, 3],
  ['1003', 'مكتب رئاسي عصري أبيض وذهبي', 'EX-GLD 200', 'مكاتب رئاسية', 1260, 32, 2],
  ['1101', 'طقم جلوس رئاسي جلد طبيعي', 'LNG-01', 'جلوس رئاسي', 1150, 30, 3],
  ['1102', 'كنبة رئاسية 3 مقاعد', 'LNG-03S', 'جلوس رئاسي', 690, 30, 5],
  ['1201', 'مكتب مدير إدارة 180 سم', 'MG-180', 'مكاتب مدراء إدارات', 520, 30, 8],
  ['1202', 'مكتب مدير إدارة بوحدة جانبية', 'MG-160L', 'مكاتب مدراء إدارات', 610, 30, 6],
  ['1301', 'طقم جلوس مدير (كنبة + 2 فوتيه)', 'MGL-21', 'جلوس مكاتب مدراء إدارات', 640, 28, 4],
  ['1401', 'مكتب موظف 120 سم بأدراج', 'ST-120', 'مكاتب موظفين', 140, 35, 30],
  ['1402', 'مكتب موظف 140 سم حديد وخشب', 'ST-140M', 'مكاتب موظفين', 175, 35, 22],
  ['1501', 'مكتب سكرتارية بكاونتر', 'SC-160', 'مكاتب سكرتارية', 330, 30, 7],
  ['1601', 'ويرك ستيشن 4 أشخاص بفواصل', 'WS-4X', 'ويرك ستيشن', 780, 28, 6],
  ['1602', 'ويرك ستيشن 6 أشخاص', 'WS-6X', 'ويرك ستيشن', 1090, 28, 3],
  ['1701', 'كاونتر استقبال منحني 240 سم', 'RC-240C', 'كاونترات استقبال', 980, 30, 2],
  ['1801', 'ترابيزة اجتماعات 10 أشخاص', 'MT-10', 'ترابيز اجتماعات', 870, 30, 3],
  ['1802', 'ترابيزة اجتماعات 6 أشخاص', 'MT-06', 'ترابيز اجتماعات', 480, 30, 5],
  ['1901', 'خزنة رقمية 60 سم', 'SF-60D', 'خزن', 260, 40, 12],
  ['1902', 'خزنة مصفحة ضد الحريق 120 سم', 'SF-120F', 'خزن', 890, 38, 4],
  ['2001', 'فايل كابينت مصفح 4 أدراج', 'FC-4A', 'فايل كابينت مصفح', 720, 32, 3],
  ['2101', 'فايل كابينت حديد 4 أدراج', 'FC-4S', 'فايل كابينت حديد', 165, 35, 15],
  ['2201', 'دولاب حديد بباب زجاج', 'CB-GL2', 'دواليب حديد', 190, 35, 10],
  ['2301', 'لوكر حديد 6 عيون', 'LK-06', 'لوكرات حديد', 210, 35, 9],
  ['2401', 'كنبة انتظار 3 مقاعد حديد', 'WB-3S', 'كنب بنوك وانتظار', 155, 35, 20],
  ['2501', 'كنبة استقبال منجدة 3 مقاعد', 'RS-3P', 'كنب مكاتب واستقبال', 260, 32, 8],
  ['2601', 'كرسي رئاسي جلد طبيعي ظهر عالي', 'CH-EX9', 'كراسي جلد فاخرة', 240, 40, 14],
  ['2602', 'كرسي مدير جلد ميكانيزم ألماني', 'CH-MG5', 'كراسي جلد فاخرة', 165, 40, 18],
  ['2603', 'كرسي موظف شبك طبي', 'CH-NET2', 'كراسي جلد فاخرة', 62, 45, 60],
  ['2701', 'كرسي طبيب دوار', 'MD-DR1', 'كراسي طبية', 95, 40, 11],
  ['2801', 'كرسي معمل ثابت', 'LB-ST1', 'كراسي معامل', 48, 45, 25],
  ['2901', 'كرسي مسرح بمسند طي', 'TH-F1', 'كراسي قاعات ومسارح', 88, 35, 120],
  ['3001', 'كرسي قاعة VIP قابل للاستلقاء', 'VIP-R2', 'كراسي VIP', 420, 32, 16],
  ['3101', 'منصة خطابة خشب وأكريليك', 'PD-01', 'منصات ندوات', 340, 35, 4],
  ['3201', 'كاونتر صراف بنك بزجاج أمني', 'BK-T1', 'مستلزمات البنوك', 1150, 30, 2],
  ['3301', 'نظام ميكروفونات مؤتمرات 20 وحدة', 'SND-C20', 'أنظمة صوتيات', 1650, 30, 2],
]

const CUSTOMERS = [
  ['بنك الخرطوم — فرع الرياض', '0912000111'], ['شركة سوداتل', '0912000222'], ['مستشفى رويال كير', '0912000333'],
  ['جامعة الخرطوم — كلية الطب', '0912000444'], ['مكتب المهندس عمر للاستشارات', '0912000555'], ['شركة دال للأغذية', '0912000666'],
  ['وزارة المالية', '0912000777'], ['د. سامي عبد الرحيم', '0912000888'],
]

export async function setupDemo(db: any, onProgress?: (m: string) => void) {
  onProgress?.('جارٍ إنشاء الجداول والصلاحيات...')
  await db.exec(bootstrap)
  await db.exec(m1)
  await db.exec(m2)
  await db.exec(m3)
  await db.exec(m5)
  await db.exec(m6)
  await db.exec(m7)
  await db.exec(m8)
  await db.exec(m10)
  await db.exec(`create table if not exists demo_passwords (username text primary key, password text not null)`)

  onProgress?.('جارٍ إضافة المستخدمين...')
  const users: [string, string, string, string, any][] = [
    ['admin', 'admin123', 'أ. والي (المدير)', 'admin', {}],
    ['sara', 'sara123', 'سارة — المعرض', 'showroom', perms('showroom')],
    ['ahmed', 'ahmed123', 'أحمد — المعرض', 'showroom', perms('showroom')],
    ['mohamed', 'mohamed123', 'محمد — المحاسب', 'accountant', perms('accountant')],
    ['khaled', 'khaled123', 'خالد — المخزن', 'warehouse', perms('warehouse')],
  ]
  const ids: Record<string, string> = {}
  for (const [u, pw, name, role, p] of users) {
    const r = await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
      [`${u}@wali.local`, JSON.stringify({ username: u, full_name: name, role, permissions: p })])
    ids[u] = r.rows[0].id
    await db.query(`insert into demo_passwords values ($1, $2)`, [u, pw])
  }
  const as = (u: string) => db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [ids[u]])
  await as('admin')

  onProgress?.('جارٍ إضافة الأصناف والموردين...')
  const today = new Date()
  const day = (back: number) => { const d = new Date(today); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10) }
  // ريت الأيام اللي فاتت
  for (let b = 45; b >= 1; b--) {
    const rate = 2450 + Math.round(Math.sin(b / 6) * 60 + (45 - b) * 2.2)
    await db.query(`insert into exchange_rates (rate, rate_date, created_by, created_at) values ($1, $2, $3, $2::date + time '09:05')`, [rate, day(b), ids.admin])
  }
  await db.query(`select set_exchange_rate(2560, 'ريت السوق الموازي')`)

  const cats = Object.fromEntries((await db.query(`select id, name from categories`)).rows.map((r: any) => [r.name, r.id]))
  const sups: string[] = []
  for (const [n, c] of [['Foshan Office Furniture Co.', 'الصين'], ['Gulf Steel Industries', 'الإمارات'], ['Istanbul Seating', 'تركيا']]) {
    sups.push((await db.query(`insert into suppliers (name, country) values ($1, $2) returning id`, [n, c])).rows[0].id)
  }
  const prodIds: Record<string, string> = {}
  for (const [code, name, model, cat, , margin] of PRODUCTS) {
    const r = await db.query(
      `insert into products (code, barcode, name, model, category_id, margin_pct, min_qty) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [code, '622' + code.padStart(9, '0'), name, model, cats[cat], margin, Number(code) > 2500 ? 5 : 2])
    prodIds[code] = r.rows[0].id
  }

  onProgress?.('جارٍ تسجيل المشتريات والشحنات...')
  const groups = [PRODUCTS.slice(0, 16), PRODUCTS.slice(16, 24), PRODUCTS.slice(24)]
  for (let g = 0; g < 3; g++) {
    const items = groups[g].map(([code, , , , usd, , qty]) => ({ product_id: prodIds[code], qty, unit_price_usd: usd }))
    const goods = items.reduce((s, i) => s + i.qty * i.unit_price_usd, 0)
    const rate = 2480
    const r = await db.query(`select to_jsonb(save_purchase($1::jsonb)) as r`, [JSON.stringify({
      supplier_id: sups[g], rate, shipping_sdg: Math.round(goods * rate * 0.09), customs_sdg: Math.round(goods * rate * 0.12),
      other_sdg: Math.round(goods * rate * 0.015), paid_sdg: Math.round(goods * rate * 0.8), items,
      notes: ['شحنة حاوية 40 قدم — بورتسودان', 'شحنة برية', 'شحنة كراسي'][g] })])
    await db.query(`update purchases set purchase_date = $1, created_at = $1::date + time '11:00' where id = $2`, [day(44 - g * 3), r.rows[0].r.id])
    await db.query(`update stock_movements set created_at = $1::date + time '11:00' where ref_id = $2`, [day(44 - g * 3), r.rows[0].r.id])
  }

  onProgress?.('جارٍ إنشاء فواتير الشهر...')
  const custIds: string[] = []
  for (const [n, ph] of CUSTOMERS) custIds.push((await db.query(`insert into customers (name, phone) values ($1, $2) returning id`, [n, ph])).rows[0].id)

  const sellers = ['sara', 'ahmed', 'sara', 'admin']
  let seed = 7
  const rnd = (n: number) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n) }
  for (let b = 40; b >= 0; b -= 1) {
    const count = b % 7 === 5 ? 0 : 1 + rnd(3)
    for (let k = 0; k < count; k++) {
      const seller = sellers[rnd(sellers.length)]
      await as(seller)
      const n = 1 + rnd(3)
      const items: { product_id: string; qty: number }[] = []
      for (let j = 0; j < n; j++) {
        const [code, , , , , , qty] = PRODUCTS[rnd(PRODUCTS.length)]
        items.push({ product_id: prodIds[code], qty: Math.max(1, Math.min(rnd(qty > 20 ? 8 : 2) + 1, 3)) })
      }
      const isFinal = rnd(10) < 7
      const cust = custIds[rnd(custIds.length)]
      try {
        const r = await db.query(`select to_jsonb(save_invoice($1::jsonb)) as r`, [JSON.stringify({
          kind: isFinal ? 'final' : 'proforma', customer_id: cust, items,
          paid_sdg: isFinal ? (rnd(3) === 0 ? 0 : 999999999999) : 0 })])
        const inv = r.rows[0].r
        if (b > 0) {
          await as('admin')
          await db.query(`update invoices set invoice_date = $1, created_at = $1::date + time '12:30' + ($3 || ' minutes')::interval, posted_at = case when posted_at is not null then $1::date + time '12:30' end where id = $2`, [day(b), inv.id, String(rnd(300))])
          await db.query(`update payments set pay_date = $1 where invoice_id = $2`, [day(b), inv.id])
          await db.query(`update notifications set created_at = $1::date + time '12:30' where entity_id = $2`, [day(b), inv.id])
          // المبدئيات القديمة يا اتحولت يا اتلغت
          if (!isFinal && b > 6) await db.query(`update invoices set status = 'cancelled', cancel_reason = 'انتهت صلاحية العرض' where id = $1`, [inv.id])
        }
      } catch { /* لو الكمية خلصت نكمّل */ }
    }
  }
  await as('admin')

  // أذونات تسليم: معظم الفواتير القديمة اتسلمت، والجديدة لسه
  const finals = (await db.query(`select id, invoice_date from invoices where kind = 'final' and status = 'posted' order by invoice_date`)).rows
  for (const [k, f] of finals.entries()) {
    if (k > finals.length - 4) break
    try {
      const dp = (await db.query(`select to_jsonb(create_delivery_permit($1)) as r`, [f.id])).rows[0].r
      if (k < finals.length - 7) await db.query(`select confirm_delivery($1)`, [dp.id])
    } catch { /* */ }
  }

  onProgress?.('جارٍ إضافة الموظفين والمساهمين...')
  const emp = async (u: string | null, name: string, title: string, salary: number, pct: number, basis = 'own') =>
    (await db.query(`insert into employees (user_id, full_name, job_title, base_salary, commission_pct, commission_basis, hired_at) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [u ? ids[u] : null, name, title, salary, pct, basis, day(400)])).rows[0].id
  const eSara = await emp('sara', 'سارة إبراهيم', 'مسؤولة مبيعات المعرض', 450000, 1.5)
  const eAhmed = await emp('ahmed', 'أحمد الطيب', 'مندوب مبيعات', 400000, 1.5)
  const eMoh = await emp('mohamed', 'محمد عثمان', 'محاسب', 550000, 0)
  const eKh = await emp('khaled', 'خالد حسن', 'أمين المخزن', 380000, 0.3, 'total')
  await emp(null, 'عبد الله يوسف', 'فني تركيب', 300000, 0)
  for (const e of [eSara, eAhmed, eMoh, eKh]) {
    for (let b = 20; b >= 1; b--) {
      const d = new Date(today); d.setDate(d.getDate() - b)
      if (d.getDay() === 5) continue
      const late = rnd(10) < 2 ? 20 + rnd(40) : 0
      await db.query(`insert into attendance (employee_id, work_date, check_in, check_out, late_minutes) values ($1, $2, $2::date + time '06:58' + ($3 || ' minutes')::interval, $2::date + time '15:02', $4) on conflict do nothing`,
        [e, day(b), String(late), late > 15 ? late : 0])
    }
  }
  await db.query(`insert into salary_advances (employee_id, amount_sdg, advance_date, notes) values ($1, 100000, $2, 'سلفة عاجلة')`, [eAhmed, day(9)])
  await db.query(`insert into salary_deductions (employee_id, amount_sdg, deduction_date, reason) values ($1, 25000, $2, 'غياب بدون إذن')`, [eKh, day(6)])

  const shs = [['أ. والي محمد', 50, 1.5, 900000], ['م. عصام الأمين', 30, 1, 700000], ['أ. هشام عبد الله', 20, 0.5, 500000]]
  for (const [name, pp, sp, sal] of shs) {
    const s = (await db.query(`insert into shareholders (full_name, joined_at) values ($1, $2) returning id`, [name, day(700)])).rows[0].id
    await db.query(`insert into shareholder_terms (shareholder_id, effective_from, monthly_salary, sales_pct, profit_pct) values ($1,$2,$3,$4,$5)`, [s, day(700), sal, sp, pp])
  }

  onProgress?.('جارٍ تسجيل المصروفات...')
  const ec = Object.fromEntries((await db.query(`select id, name from expense_categories`)).rows.map((r: any) => [r.name, r.id]))
  const exps: [string, number, number, string][] = [
    ['إيجارات', 2500000, 30, 'إيجار المعرض — شهر'], ['كهرباء ومياه', 380000, 25, 'فاتورة الكهرباء'],
    ['نقل وتركيب', 220000, 18, 'نقل طلبية بنك الخرطوم'], ['دعاية وإعلان', 450000, 14, 'إعلانات فيسبوك وتيك توك'],
    ['مساهمات في الأعمال الاجتماعية', 300000, 10, 'دعم مبادرة إفطار صائم'], ['صيانة', 95000, 5, 'صيانة التكييف'],
    ['نقل وتركيب', 140000, 3, 'تركيب ويرك ستيشن سوداتل'],
  ]
  for (const [c, amt, b, d] of exps) {
    await db.query(`insert into expenses (category_id, amount_sdg, expense_date, description, created_at) values ($1,$2,$3,$4,$3::date + time '10:00')`, [ec[c], amt, day(b), d])
  }

  await db.query(`update settings set address = 'الخرطوم — شارع المك نمر' where id = 1`)
  await db.query(`update delivery_permits d set created_at = i.created_at + interval '3 hours', delivered_at = case when d.delivered_at is not null then i.created_at + interval '1 day' end from invoices i where i.id = d.invoice_id`)
  // وقت كل إشعار = وقت الحدث نفسه، وآخر كام إشعار بس يفضلوا غير مقروءين
  for (const t of ['delivery_permits', 'invoices', 'purchases', 'payments', 'expenses', 'exchange_rates', 'stock_movements', 'products', 'customers', 'suppliers', 'employees', 'shareholders', 'shareholder_terms', 'salary_advances', 'salary_deductions', 'profiles']) {
    await db.query(`update notifications n set created_at = x.created_at from public.${t} x where n.entity_type = '${t}' and n.entity_id = x.id`)
  }
  await db.query(`update notifications n set created_at = coalesce(a.check_out, a.check_in) from attendance a where n.entity_type = 'attendance' and n.entity_id = a.id`)
  await db.query(`update notifications n set created_at = i.created_at from invoices i where n.entity_type = 'payments' and (n.data ->> 'invoice_id')::uuid = i.id`)
  await db.query(`update notifications set read_at = now()`)
  await db.query(`update notifications set read_at = null where id in (select id from notifications order by created_at desc limit 7)`)
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  onProgress?.('اكتمل التجهيز!')
}

// صلاحيات جاهزة لكل دور (نفسها في lib/perms.ts)
function perms(role: string) {
  const all = ['view', 'create', 'edit', 'approve', 'print', 'cancel']
  const v = ['view']
  const vc = ['view', 'create', 'print']
  switch (role) {
    case 'showroom': return { dashboard: v, products: v, customers: ['view', 'create', 'edit'], sales: vc, rates: v }
    case 'accountant': return {
      dashboard: v, products: v, customers: all, suppliers: all, sales: ['view', 'create', 'edit', 'print'], purchases: all,
      accounting: all, expenses: all, delivery: ['view', 'create', 'print', 'cancel'], payroll: all, hr: v, attendance: v,
      reports: v, rates: ['view', 'create'], stock: v,
    }
    case 'warehouse': return { dashboard: v, products: ['view', 'create', 'edit', 'print'], stock: ['view', 'edit', 'print'], delivery: ['view', 'approve', 'print'], purchases: v, rates: v }
    default: return {}
  }
}
