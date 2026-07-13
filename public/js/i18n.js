/**
 * Lightweight i18n. English strings are the keys; dictionaries map them to
 * Arabic (RTL) and French. t(s) falls back to the English string, so pages
 * that are not yet translated keep working. Language persists in localStorage
 * and switching re-renders the app (App.route()).
 *
 * To add a language: add a dictionary below and an option in the topbar select.
 */
const I18N = {
  ar: {
    // sections
    'General': 'عام', 'Material Requests': 'طلبات المواد', 'Warehouse Execution': 'تنفيذ المستودع',
    'Receiving & Quality': 'الاستلام والجودة', 'Inventory': 'المخزون', 'Master Data': 'البيانات الرئيسية',
    'Administration': 'الإدارة',
    // menu
    'Dashboard': 'لوحة التحكم', 'KPI Dashboard': 'مؤشرات الأداء', 'Notifications': 'الإشعارات',
    'AI Stock Analytics': 'تحليلات المخزون الذكية',
    'Create Request': 'إنشاء طلب', 'Requests': 'الطلبات', 'Approvals': 'الموافقات', 'ERP Operator': 'مشغل ERP',
    'Warehouse Dashboard': 'لوحة المستودع', 'Bin & Batch Assign': 'تخصيص الموقع والدفعة',
    'Picker Assignment': 'تعيين المنفذ', 'My Picking Tasks': 'مهام الالتقاط', 'Goods Issue Posting': 'ترحيل الصرف',
    'Goods Receipt & QR': 'استلام البضائع و QR', 'QR Label Printing': 'طباعة ملصقات QR',
    'Batch Tracking': 'تتبع الدفعات', 'Expiry Alerts': 'تنبيهات الصلاحية', 'Quality': 'الجودة',
    'All Locations': 'كل المواقع', 'Empty Locations': 'المواقع الفارغة',
    'Materials': 'المواد', 'Locations': 'المواقع', 'Warehouses': 'المستودعات', 'Bin Locations': 'مواقع التخزين',
    'Movement Types': 'أنواع الحركة', 'Audit Trail': 'سجل التدقيق', 'Users Management': 'إدارة المستخدمين',
    'Permissions': 'الصلاحيات',
    // titles
    'Create Material Request': 'إنشاء طلب مواد', 'Request Detail': 'تفاصيل الطلب',
    'Manager Approvals': 'موافقات المدير', 'ERP Operator Queue': 'قائمة مشغل ERP',
    'Bin & Batch Assignment': 'تخصيص الموقع والدفعة', 'Quality Management': 'إدارة الجودة',
    'Warehouse Master': 'المستودعات الرئيسية', 'Bin Location Master': 'مواقع التخزين الرئيسية',
    'Movement Type Config': 'إعداد أنواع الحركة', 'Permissions Management': 'إدارة الصلاحيات',
    // common
    'Logout': 'تسجيل الخروج', 'Login': 'تسجيل الدخول', 'Sign up': 'إنشاء حساب', 'Email': 'البريد الإلكتروني',
    'Password': 'كلمة المرور', 'Full name': 'الاسم الكامل', 'Save': 'حفظ', 'Cancel': 'إلغاء',
    'Language': 'اللغة', 'Theme': 'المظهر', 'Warehouse Management System': 'نظام إدارة المستودعات',
    'Loading…': 'جارٍ التحميل…',
    // common actions
    'Submit': 'إرسال', 'Delete': 'حذف', 'Edit': 'تعديل', 'Add': 'إضافة', 'Close': 'إغلاق', 'Back': 'رجوع',
    'Search': 'بحث', 'Reset': 'إعادة تعيين', 'Export': 'تصدير', 'Download': 'تنزيل', 'Upload': 'رفع',
    'Reason': 'السبب', 'Confirm': 'تأكيد', 'Approve': 'موافقة', 'Reject': 'رفض', 'Return': 'إرجاع',
    'Status': 'الحالة', 'Quantity': 'الكمية', 'Actions': 'إجراءات', 'Details': 'التفاصيل',
    // new features (P2/P3)
    'Cycle Counting': 'الجرد الدوري', 'Attachments': 'المرفقات', 'Reverse GI': 'عكس الصرف',
    'Reverse Goods Issue': 'عكس صرف البضائع', 'High-Value Approvals': 'موافقات عالية القيمة',
    'Counted quantity': 'الكمية المعدودة', 'Variance': 'الفرق', 'System quantity': 'كمية النظام',
    'Upload file': 'رفع ملف', 'No attachments': 'لا توجد مرفقات',
  },
  fr: {
    'General': 'Général', 'Material Requests': 'Demandes de matériel', 'Warehouse Execution': 'Exécution entrepôt',
    'Receiving & Quality': 'Réception et qualité', 'Inventory': 'Inventaire', 'Master Data': 'Données de base',
    'Administration': 'Administration',
    'Dashboard': 'Tableau de bord', 'KPI Dashboard': 'Tableau KPI', 'Notifications': 'Notifications',
    'AI Stock Analytics': 'Analyse IA du stock',
    'Create Request': 'Créer une demande', 'Requests': 'Demandes', 'Approvals': 'Approbations', 'ERP Operator': 'Opérateur ERP',
    'Warehouse Dashboard': "Tableau d'entrepôt", 'Bin & Batch Assign': 'Affectation casier/lot',
    'Picker Assignment': 'Affectation préparateur', 'My Picking Tasks': 'Mes préparations', 'Goods Issue Posting': 'Sortie de marchandises',
    'Goods Receipt & QR': 'Réception & QR', 'QR Label Printing': 'Impression étiquettes QR',
    'Batch Tracking': 'Suivi des lots', 'Expiry Alerts': 'Alertes de péremption', 'Quality': 'Qualité',
    'All Locations': 'Tous les emplacements', 'Empty Locations': 'Emplacements vides',
    'Materials': 'Articles', 'Locations': 'Emplacements', 'Warehouses': 'Entrepôts', 'Bin Locations': 'Casiers',
    'Movement Types': 'Types de mouvement', 'Audit Trail': "Piste d'audit", 'Users Management': 'Gestion des utilisateurs',
    'Permissions': 'Autorisations',
    'Create Material Request': 'Créer une demande de matériel', 'Request Detail': 'Détail de la demande',
    'Manager Approvals': 'Approbations manager', 'ERP Operator Queue': "File de l'opérateur ERP",
    'Bin & Batch Assignment': 'Affectation casier/lot', 'Quality Management': 'Gestion de la qualité',
    'Warehouse Master': 'Référentiel entrepôts', 'Bin Location Master': 'Référentiel casiers',
    'Movement Type Config': 'Config. types de mouvement', 'Permissions Management': 'Gestion des autorisations',
    'Logout': 'Déconnexion', 'Login': 'Connexion', 'Sign up': "S'inscrire", 'Email': 'E-mail',
    'Password': 'Mot de passe', 'Full name': 'Nom complet', 'Save': 'Enregistrer', 'Cancel': 'Annuler',
    'Language': 'Langue', 'Theme': 'Thème', 'Warehouse Management System': 'Système de gestion d’entrepôt',
    'Loading…': 'Chargement…',
    // common actions
    'Submit': 'Soumettre', 'Delete': 'Supprimer', 'Edit': 'Modifier', 'Add': 'Ajouter', 'Close': 'Fermer', 'Back': 'Retour',
    'Search': 'Rechercher', 'Reset': 'Réinitialiser', 'Export': 'Exporter', 'Download': 'Télécharger', 'Upload': 'Téléverser',
    'Reason': 'Motif', 'Confirm': 'Confirmer', 'Approve': 'Approuver', 'Reject': 'Rejeter', 'Return': 'Retourner',
    'Status': 'Statut', 'Quantity': 'Quantité', 'Actions': 'Actions', 'Details': 'Détails',
    // new features (P2/P3)
    'Cycle Counting': "Comptage tournant", 'Attachments': 'Pièces jointes', 'Reverse GI': 'Annuler la sortie',
    'Reverse Goods Issue': 'Annuler la sortie de marchandises', 'High-Value Approvals': 'Approbations à forte valeur',
    'Counted quantity': 'Quantité comptée', 'Variance': 'Écart', 'System quantity': 'Quantité système',
    'Upload file': 'Téléverser un fichier', 'No attachments': 'Aucune pièce jointe',
  },
};

const RTL_LANGS = ['ar'];

window.Lang = {
  current: localStorage.getItem('wms_lang') || 'en',
  set(lang) {
    this.current = lang;
    localStorage.setItem('wms_lang', lang);
    this.applyDir();
    if (window.App) App.route();
  },
  applyDir() {
    document.documentElement.lang = this.current;
    document.documentElement.dir = RTL_LANGS.includes(this.current) ? 'rtl' : 'ltr';
  },
};
Lang.applyDir();

/** Translate an English string into the active language (fallback: as-is). */
function t(s) {
  const dict = I18N[Lang.current];
  return (dict && dict[s]) || s;
}
window.t = t;

/**
 * Theme preference (light / dark). Persists in localStorage; switching
 * re-renders the app so charts pick up the theme-aware palette.
 */
window.Theme = {
  current: localStorage.getItem('wms_theme') || 'light',
  apply() { document.documentElement.dataset.theme = this.current; },
  set(theme) {
    this.current = theme;
    localStorage.setItem('wms_theme', theme);
    this.apply();
    if (window.App) App.route();
  },
  toggle() { this.set(this.current === 'dark' ? 'light' : 'dark'); },
};
Theme.apply();
