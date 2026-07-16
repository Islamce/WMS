/// Lightweight i18n mirroring the web app: English strings are the keys and
/// [t] falls back to the key itself, so untranslated screens keep working.
/// The active language lives in [I18n.current]; Session persists it and
/// notifies the app to rebuild (Arabic also flips the app to RTL).
library;

class I18n {
  static String current = 'en';

  static const Map<String, Map<String, String>> _dict = {
    'ar': {
      // menu / sections
      'Dashboard': 'لوحة التحكم', 'AI Stock Analytics': 'تحليلات المخزون الذكية',
      'Notifications': 'الإشعارات', 'Create Request': 'إنشاء طلب', 'Requests': 'الطلبات',
      'Approvals': 'الموافقات', 'ERP Operator': 'مشغل ERP',
      'Bin & Batch Assign': 'تخصيص الموقع والدفعة', 'Picker Assignment': 'تعيين المنفذ',
      'My Picking Tasks': 'مهام الالتقاط', 'Goods Issue Posting': 'ترحيل الصرف',
      'Goods Receipt': 'استلام البضائع', 'Quality Inspection': 'فحص الجودة',
      'Batch Tracking': 'تتبع الدفعات', 'Expiry Alerts': 'تنبيهات الصلاحية',
      'Cycle Counting': 'الجرد الدوري', 'Materials': 'المواد', 'Users': 'المستخدمون',
      'Audit Trail': 'سجل التدقيق',
      'General': 'عام', 'Material Requests': 'طلبات المواد',
      'Warehouse Execution': 'تنفيذ المستودع', 'Receiving & Quality': 'الاستلام والجودة',
      'Master Data & Admin': 'البيانات الرئيسية والإدارة',
      // common
      'Settings': 'الإعدادات', 'Server': 'الخادم', 'Server URL': 'رابط الخادم',
      'Save': 'حفظ', 'Account': 'الحساب', 'Sign out': 'تسجيل الخروج',
      'Login': 'تسجيل الدخول', 'Email': 'البريد الإلكتروني', 'Password': 'كلمة المرور',
      'Language': 'اللغة', 'Theme': 'المظهر', 'System': 'النظام', 'Light': 'فاتح', 'Dark': 'داكن',
      'Appearance': 'المظهر واللغة', 'Name': 'الاسم', 'Role': 'الدور', 'Permissions': 'الصلاحيات',
      'Submit': 'إرسال', 'Cancel': 'إلغاء', 'Confirm': 'تأكيد', 'Back': 'رجوع',
      'Approve': 'موافقة', 'Reject': 'رفض', 'Search': 'بحث', 'Status': 'الحالة',
      'Server URL saved.': 'تم حفظ رابط الخادم.',
    },
    'fr': {
      'Dashboard': 'Tableau de bord', 'AI Stock Analytics': 'Analyse IA du stock',
      'Notifications': 'Notifications', 'Create Request': 'Créer une demande', 'Requests': 'Demandes',
      'Approvals': 'Approbations', 'ERP Operator': 'Opérateur ERP',
      'Bin & Batch Assign': 'Affectation casier/lot', 'Picker Assignment': 'Affectation préparateur',
      'My Picking Tasks': 'Mes préparations', 'Goods Issue Posting': 'Sortie de marchandises',
      'Goods Receipt': 'Réception', 'Quality Inspection': 'Inspection qualité',
      'Batch Tracking': 'Suivi des lots', 'Expiry Alerts': 'Alertes de péremption',
      'Cycle Counting': 'Comptage tournant', 'Materials': 'Articles', 'Users': 'Utilisateurs',
      'Audit Trail': "Piste d'audit",
      'General': 'Général', 'Material Requests': 'Demandes de matériel',
      'Warehouse Execution': 'Exécution entrepôt', 'Receiving & Quality': 'Réception et qualité',
      'Master Data & Admin': 'Données de base et admin',
      'Settings': 'Paramètres', 'Server': 'Serveur', 'Server URL': 'URL du serveur',
      'Save': 'Enregistrer', 'Account': 'Compte', 'Sign out': 'Déconnexion',
      'Login': 'Connexion', 'Email': 'E-mail', 'Password': 'Mot de passe',
      'Language': 'Langue', 'Theme': 'Thème', 'System': 'Système', 'Light': 'Clair', 'Dark': 'Sombre',
      'Appearance': 'Apparence', 'Name': 'Nom', 'Role': 'Rôle', 'Permissions': 'Autorisations',
      'Submit': 'Soumettre', 'Cancel': 'Annuler', 'Confirm': 'Confirmer', 'Back': 'Retour',
      'Approve': 'Approuver', 'Reject': 'Rejeter', 'Search': 'Rechercher', 'Status': 'Statut',
      'Server URL saved.': 'URL du serveur enregistrée.',
    },
  };

  static bool get isRtl => current == 'ar';
  static String t(String s) => _dict[current]?[s] ?? s;
}

/// Translate [s] into the active language (falls back to the English key).
String t(String s) => I18n.t(s);
