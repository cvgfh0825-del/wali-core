// الموديولات والأفعال — لازم تطابق الأسماء اللي في has_perm جوه الداتا بيز
export const ACTIONS = [
  { key: 'view', label: 'عرض' },
  { key: 'create', label: 'إضافة' },
  { key: 'edit', label: 'تعديل' },
  { key: 'approve', label: 'اعتماد' },
  { key: 'print', label: 'طباعة' },
  { key: 'cancel', label: 'إلغاء' },
] as const

export const MODULES = [
  { key: 'dashboard', label: 'لوحة التحكم' },
  { key: 'sales', label: 'المبيعات والفواتير', hint: 'الاعتماد = تعديل الأسعار يدوياً' },
  { key: 'customers', label: 'العملاء' },
  { key: 'products', label: 'الأصناف' },
  { key: 'stock', label: 'المخزن والجرد', hint: 'التعديل = تسوية الكميات' },
  { key: 'purchases', label: 'المشتريات' },
  { key: 'suppliers', label: 'الموردين' },
  { key: 'delivery', label: 'أذونات التسليم', hint: 'الاعتماد = تأكيد التسليم من المخزن' },
  { key: 'accounting', label: 'المقبوضات والمدفوعات' },
  { key: 'expenses', label: 'المصروفات' },
  { key: 'rates', label: 'سعر الدولار', hint: 'الإضافة = كتابة ريت اليوم' },
  { key: 'hr', label: 'الموظفين' },
  { key: 'attendance', label: 'الحضور والانصراف' },
  { key: 'payroll', label: 'المرتبات والسلف', hint: 'الاعتماد = صرف المرتب' },
  { key: 'shareholders', label: 'المساهمين', hint: 'الاعتماد = صرف المستحقات' },
  { key: 'reports', label: 'التقارير والأرباح' },
  { key: 'users', label: 'المستخدمين والصلاحيات' },
  { key: 'settings', label: 'الإعدادات' },
] as const

const all = ['view', 'create', 'edit', 'approve', 'print', 'cancel']
const v = ['view']
const vc = ['view', 'create', 'print']

export const ROLE_PRESETS: Record<string, { label: string; color: string; perms: Record<string, string[]> }> = {
  admin: { label: 'مدير النظام', color: 'brand', perms: {} },
  showroom: {
    label: 'موظف معرض', color: 'sky',
    perms: { dashboard: v, products: v, customers: ['view', 'create', 'edit'], sales: vc, rates: v },
  },
  accountant: {
    label: 'محاسب', color: 'emerald',
    perms: {
      dashboard: v, products: v, customers: all, suppliers: all, sales: ['view', 'create', 'edit', 'print'], purchases: all,
      accounting: all, expenses: all, delivery: ['view', 'create', 'print', 'cancel'], payroll: all, hr: v, attendance: v,
      reports: v, rates: ['view', 'create'], stock: v,
    },
  },
  warehouse: {
    label: 'أمين مخزن', color: 'violet',
    perms: { dashboard: v, products: ['view', 'create', 'edit', 'print'], stock: ['view', 'edit', 'print'], delivery: ['view', 'approve', 'print'], purchases: v, rates: v },
  },
  custom: { label: 'صلاحيات مخصصة', color: 'zinc', perms: {} },
}
