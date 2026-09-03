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
      'Home': 'الرئيسية', 'Good morning': 'صباح الخير', 'Good afternoon': 'مساء الخير',
      'Good evening': 'مساء الخير', 'Pick a process to get started': 'اختر عملية للبدء',
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
      // R3: reallocation / inventory / shipping / scanning
      'Stock Reallocation': 'إعادة توزيع المخزون', 'Shipping & Outbound': 'الشحن والصادر',
      'Delivery & Dispatch': 'التسليم والإرسال', 'Physical Inventory': 'الجرد الفعلي',
      'Press back again to exit': 'اضغط رجوع مرة أخرى للخروج',
      'Scan QR / barcode': 'مسح QR / باركود', 'Scan with camera': 'مسح بالكاميرا',
      'Point the camera at the batch or bin label': 'وجّه الكاميرا نحو ملصق الدفعة أو الموقع',
      'Scan Bin': 'مسح الموقع', 'Scan bin QR / barcode': 'مسح رمز QR / باركود الموقع',
      'Scan bin label': 'مسح ملصق الموقع', 'Or enter bin code': 'أو أدخل رمز الموقع',
      'Go': 'انتقال', 'Could not look up this bin.': 'تعذّر العثور على هذا الموقع.',
      'Occupied': 'مشغول', 'Empty': 'فارغ', 'Contents': 'المحتويات',
      'Batch / lot detail': 'تفاصيل الدفعة', 'Batch': 'دفعة', 'Expiry': 'الصلاحية',
      'Quality': 'الجودة', 'Hazard': 'خطر', 'Temperature controlled': 'محكوم الحرارة',
      'Quality restricted': 'مقيد الجودة',
      'Reallocate': 'إعادة توزيع', 'Move stock': 'نقل المخزون',
      'New reallocation': 'إعادة توزيع جديدة', 'No reallocations yet': 'لا توجد عمليات إعادة توزيع',
      'Quantity to move': 'الكمية المنقولة', 'Target warehouse': 'المستودع الهدف',
      'Target bin': 'الموقع الهدف', 'Reason': 'السبب',
      'Count session': 'جلسة جرد', 'New count session': 'جلسة جرد جديدة',
      'Annual inventory': 'جرد سنوي', 'Periodic inventory': 'جرد دوري',
      'Counted quantity': 'الكمية المعدودة', 'Record count': 'تسجيل العد',
      'Post adjustments': 'ترحيل التسويات', 'Move to review': 'إلى المراجعة',
      'Cancel session': 'إلغاء الجلسة', 'Recount': 'إعادة العد', 'Count': 'عد',
      'Delivery order': 'أمر تسليم', 'New delivery order': 'أمر تسليم جديد',
      'Pack': 'تعبئة', 'Load': 'تحميل', 'Dispatch': 'إرسال', 'Deliver': 'تسليم',
      'Ship to': 'الوجهة', 'Carrier': 'الناقل', 'Received by': 'المستلم',
      'Confirm delivery (POD)': 'تأكيد التسليم', 'Confirm delivery': 'تأكيد التسليم',
      'Create shipment': 'إنشاء شحنة', 'No shipments yet': 'لا توجد شحنات',
      'Requester': 'مقدم الطلب', 'Department': 'القسم', 'Project': 'المشروع',
      'Cost Center': 'مركز التكلفة', 'Priority': 'الأولوية', 'Required date': 'التاريخ المطلوب',
      'Purpose': 'الغرض',
      // R4: reverse workflow / dashboard drill-through
      'Reverse one step': 'الرجوع خطوة للوراء',
      'Reason (releases any reservation, allocation or picking task this stage holds)':
          'السبب(ɏفرج عن أي حجز أو تخصيص أو مهمة التقاط تحتفظ بها هذه المرحلة)',
      'Request reversed.': 'تم إرجاع الطلب.',
    },
    'fr': {
      'Home': 'Accueil', 'Good morning': 'Bonjour', 'Good afternoon': 'Bonjour',
      'Good evening': 'Bonsoir', 'Pick a process to get started': 'Choisissez un processus pour commencer',
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
      // R3: reallocation / inventory / shipping / scanning
      'Stock Reallocation': 'Réaffectation du stock', 'Shipping & Outbound': 'Expédition',
      'Delivery & Dispatch': 'Livraison et envoi', 'Physical Inventory': 'Inventaire physique',
      'Press back again to exit': 'Appuyez à nouveau pour quitter',
      'Scan QR / barcode': 'Scanner QR / code-barres', 'Scan with camera': 'Scanner avec la caméra',
      'Point the camera at the batch or bin label': "Visez l'étiquette du lot ou du casier",
      'Scan Bin': 'Scanner un casier', 'Scan bin QR / barcode': 'Scanner le QR / code-barres du casier',
      'Scan bin label': "Scanner l'étiquette du casier", 'Or enter bin code': 'Ou saisir le code du casier',
      'Go': 'Aller', 'Could not look up this bin.': 'Impossible de trouver ce casier.',
      'Occupied': 'Occupé', 'Empty': 'Vide', 'Contents': 'Contenu',
      'Batch / lot detail': 'Détail du lot', 'Batch': 'Lot', 'Expiry': 'Expiration',
      'Quality': 'Qualité', 'Hazard': 'Danger', 'Temperature controlled': 'Température contrôlée',
      'Quality restricted': 'Restriction qualité',
      'Reallocate': 'Réaffecter', 'Move stock': 'Déplacer le stock',
      'New reallocation': 'Nouvelle réaffectation', 'No reallocations yet': 'Aucune réaffectation',
      'Quantity to move': 'Quantité à déplacer', 'Target warehouse': 'Entrepôt cible',
      'Target bin': 'Casier cible', 'Reason': 'Motif',
      'Count session': 'Session de comptage', 'New count session': 'Nouvelle session de comptage',
      'Annual inventory': 'Inventaire annuel', 'Periodic inventory': 'Inventaire périodique',
      'Counted quantity': 'Quantité comptée', 'Record count': 'Enregistrer le comptage',
      'Post adjustments': 'Valider les ajustements', 'Move to review': 'Passer en revue',
      'Cancel session': 'Annuler la session', 'Recount': 'Recompter', 'Count': 'Compter',
      'Delivery order': 'Ordre de livraison', 'New delivery order': 'Nouvel ordre de livraison',
      'Pack': 'Emballer', 'Load': 'Charger', 'Dispatch': 'Expédier', 'Deliver': 'Livrer',
      'Ship to': 'Destination', 'Carrier': 'Transporteur', 'Received by': 'Reçu par',
      'Confirm delivery (POD)': 'Confirmer la livraison', 'Confirm delivery': 'Confirmer la livraison',
      'Create shipment': "Créer l'expédition", 'No shipments yet': 'Aucune expédition',
      'Requester': 'Demandeur', 'Department': 'Département', 'Project': 'Projet',
      'Cost Center': 'Centre de coûts', 'Priority': 'Priorité', 'Required date': 'Date requise',
      'Purpose': 'Objet',
      // R4: reverse workflow / dashboard drill-through
      'Reverse one step': 'Revenir en arrière d\'une étape',
      'Reason (releases any reservation, allocation or picking task this stage holds)':
          'Motif (libère toute réservation, allocation ou tâche de préparation détenue à ce stade)',
      'Request reversed.': 'Demande renvoyée en arrière.',
    },
  };

  static bool get isRtl => current == 'ar';
  static String t(String s) => _dict[current]?[s] ?? s;
}

/// Translate [s] into the active language (falls back to the English key).
String t(String s) => I18n.t(s);
