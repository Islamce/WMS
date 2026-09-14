/** Public bilingual product landing page. Authentication remains at #/login. */
window.Pages = window.Pages || {};

Pages.landing = {
  activeDemo: 'control',
  slideTheme: 'light',

  copy: {
    en: {
      nav: ['Solution', 'Workflow', 'Demo'],
      signIn: 'Sign in',
      eyebrow: 'Warehouse operations and material control platform',
      title: 'One workspace connecting every material movement',
      body: 'From request and approval to receiving, picking, goods issue, and audit — WMS gives every team a clear, controlled path from need to stock movement.',
      explore: 'Explore the workflow',
      proofEyebrow: 'Interactive product walkthrough',
      proofTitle: 'Operational control from request to warehouse execution',
      proofBody: 'Move between WMS demonstration views built with clearly hypothetical operational data. Choose the light or dark presentation to review each workflow.',
      previewStyle: 'Preview style',
      lightStyle: 'Light',
      darkStyle: 'Dark',
      demoData: 'Hypothetical demo data',
      tabs: { control: 'Operations control', inbound: 'Inbound & quality', outbound: 'Outbound & issue', mobile: 'Mobile execution', trace: 'Material network' },
      alts: { control: 'WMS operations control workspace', inbound: 'WMS inbound quality inspection workspace', outbound: 'WMS outbound goods issue posting queue', mobile: 'WMS mobile warehouse picking workflow', trace: 'Connected warehouse and logistics network' },
      notes: {
        control: ['Prioritized work in one queue', 'Clear ownership and service level', 'Decision history beside the task'],
        inbound: ['Receive and identify every batch', 'Quality status before allocation', 'Expiry and release controls in one view'],
        outbound: ['Review ready requests by reservation', 'Post goods issue with full context', 'Keep request, movement, and warehouse linked'],
        mobile: ['Task guidance for warehouse teams', 'Scan-driven location confirmation', 'Shortage handling inside the workflow'],
        trace: ['Connected warehouse movements', 'One source for material status', 'Traceability from receipt to issue'],
      },
      journeyEyebrow: 'A controlled warehouse journey',
      journeyTitle: 'Eight connected controls from demand to dispatch',
      phases: ['Demand', 'Inbound', 'Execution', 'Outbound & control'],
      journey: [
        ['Request materials', 'Capture project, cost object, required date, priority, and line quantities.'],
        ['Approve and reserve', 'Route the decision, validate availability, and create the ERP reservation.'],
        ['Receive and identify', 'Record the receipt, batch, warehouse, dates, and QR identity.'],
        ['Inspect and release', 'Hold new stock for quality, then release, block, or reject it visibly.'],
        ['Allocate and assign', 'Apply FIFO or FEFO by bin and batch, then assign accountable operators.'],
        ['Pick and scan', 'Guide physical execution with QR, location confirmation, and shortage handling.'],
        ['Issue and dispatch', 'Post goods issue, pack the delivery, and confirm dispatch against the request.'],
        ['Count and audit', 'Reconcile stock, investigate exceptions, and retain the complete decision trail.'],
      ],
      designed: 'Designed for every warehouse decision-maker',
      audiences: [
        ['Warehouse operations', 'A focused daily workspace for receiving, picking, issuing, and stock control.'],
        ['Project and maintenance teams', 'Clear material-request status from demand through physical delivery.'],
        ['Management and audit', 'Reliable approvals, accountability, exception evidence, and operational KPIs.'],
      ],
      finalTitle: 'See WMS manage a complete material journey',
      finalBody: 'Explore how KYNOX WMS connects the office decision to the physical warehouse action without losing control or traceability.',
      tour: 'Start the product tour',
      footer: 'WMS by KYNOX — controlled warehouse execution and material traceability in one operational platform.',
    },
    ar: {
      nav: ['الحل', 'رحلة العمل', 'العرض'],
      signIn: 'تسجيل الدخول',
      eyebrow: 'منصة عمليات المستودعات والتحكم في المواد',
      title: 'مساحة واحدة تربط كل حركة للمواد',
      body: 'من الطلب والاعتماد إلى الاستلام والالتقاط والصرف والتدقيق — يمنح WMS كل فريق مساراً واضحاً ومنضبطاً من الاحتياج حتى حركة المخزون.',
      explore: 'استكشف رحلة العمل',
      proofEyebrow: 'عرض تفاعلي للمنتج',
      proofTitle: 'تحكم تشغيلي من الطلب حتى التنفيذ داخل المستودع',
      proofBody: 'تنقّل بين شاشات WMS ببيانات تشغيلية افتراضية بالكامل، واختر العرض الفاتح أو الداكن لمراجعة كل رحلة عمل.',
      previewStyle: 'نمط العرض',
      lightStyle: 'فاتح',
      darkStyle: 'داكن',
      demoData: 'بيانات افتراضية للعرض',
      tabs: { control: 'التحكم التشغيلي', inbound: 'الاستلام والجودة', outbound: 'الصرف والشحن', mobile: 'التنفيذ الميداني', trace: 'شبكة المواد' },
      alts: { control: 'مساحة التحكم في عمليات WMS', inbound: 'مساحة فحص الجودة لعمليات الاستلام في WMS', outbound: 'قائمة ترحيل الصرف للعمليات الصادرة في WMS', mobile: 'رحلة الالتقاط الميدانية عبر WMS', trace: 'شبكة المستودعات والخدمات اللوجستية المترابطة' },
      notes: {
        control: ['أولوية العمل في قائمة واحدة', 'ملكية واضحة ومستوى خدمة محدد', 'سجل القرار بجوار المهمة'],
        inbound: ['استلام وتعريف كل دفعة', 'قرار الجودة قبل التخصيص', 'الصلاحية والإفراج في عرض واحد'],
        outbound: ['مراجعة الطلبات الجاهزة حسب الحجز', 'ترحيل الصرف بالسياق الكامل', 'ربط الطلب والحركة والمستودع'],
        mobile: ['توجيه واضح لفريق المستودع', 'تأكيد الموقع والمسح بالرمز', 'معالجة النقص داخل رحلة العمل'],
        trace: ['حركات مستودعات مترابطة', 'مصدر واحد لحالة المواد', 'تتبع من الاستلام حتى الصرف'],
      },
      journeyEyebrow: 'رحلة مستودع منضبطة',
      journeyTitle: 'ثماني نقاط تحكم مترابطة من الاحتياج حتى الشحن',
      phases: ['الطلب', 'الاستلام', 'التنفيذ', 'الصرف والرقابة'],
      journey: [
        ['طلب المواد', 'تسجيل المشروع والتكلفة والتاريخ المطلوب والأولوية وكميات البنود.'],
        ['الاعتماد والحجز', 'توجيه القرار والتحقق من التوفر وإنشاء حجز نظام ERP.'],
        ['الاستلام والتعريف', 'تسجيل الاستلام والدفعة والمستودع والتواريخ وهوية QR.'],
        ['الفحص والإفراج', 'حجز المخزون الجديد للجودة ثم الإفراج عنه أو حجبه أو رفضه بوضوح.'],
        ['التخصيص والتكليف', 'تطبيق FIFO أو FEFO حسب الموقع والدفعة وتعيين المنفذ المسؤول.'],
        ['الالتقاط والمسح', 'توجيه التنفيذ عبر QR وتأكيد الموقع ومعالجة النقص داخل المهمة.'],
        ['الصرف والشحن', 'ترحيل الصرف وتعبئة التسليم وتأكيد الشحن مقابل الطلب.'],
        ['الجرد والتدقيق', 'مطابقة المخزون والتحقيق في الاستثناءات وحفظ سجل القرار الكامل.'],
      ],
      designed: 'مصمم لكل صاحب قرار في المستودع',
      audiences: [
        ['عمليات المستودع', 'مساحة يومية مركزة للاستلام والالتقاط والصرف والتحكم في المخزون.'],
        ['فرق المشاريع والصيانة', 'حالة واضحة لطلب المواد من الاحتياج حتى التسليم الفعلي.'],
        ['الإدارة والتدقيق', 'اعتمادات موثوقة ومسؤوليات واضحة وأدلة للاستثناءات ومؤشرات تشغيلية.'],
      ],
      finalTitle: 'شاهد WMS يدير رحلة مواد متكاملة',
      finalBody: 'اكتشف كيف يربط KYNOX WMS القرار المكتبي بالتنفيذ الفعلي داخل المستودع دون فقدان التحكم أو التتبع.',
      tour: 'ابدأ العرض التوضيحي',
      footer: 'WMS من KYNOX — تنفيذ مستودعات منضبط وتتبع للمواد في منصة تشغيلية واحدة.',
    },
  },

  demos: {
    control: { light: '/design-preview/kynox-redesign-preview-desktop.png', dark: '/design-preview/kynox-redesign-preview-desktop.png' },
    inbound: { light: '/img/landing/demo/inbound-light.png', dark: '/img/landing/demo/inbound-dark.png' },
    outbound: { light: '/img/landing/demo/outbound-light.png', dark: '/img/landing/demo/outbound-dark.png' },
    mobile: { light: '/design-preview/kynox-redesign-preview-mobile.png', dark: '/design-preview/kynox-redesign-preview-mobile.png' },
    trace: { light: '/img/hero-network.jpg', dark: '/img/hero-network.jpg' },
  },

  render() {
    const locale = Lang.current === 'ar' ? 'ar' : 'en';
    const c = this.copy[locale];
    const arrow = locale === 'ar' ? 'ph-arrow-left' : 'ph-arrow-right';
    const journeyIcons = ['ph-clipboard-text', 'ph-check-circle', 'ph-download-simple', 'ph-shield-check', 'ph-package', 'ph-scan', 'ph-truck', 'ph-chart-line-up'];
    const audienceIcons = ['ph-warehouse', 'ph-hard-hat', 'ph-shield-check'];
    const demo = this.activeDemo;
    const slideTheme = this.slideTheme;
    const demoSource = (key) => this.demos[key][slideTheme];
    document.title = locale === 'ar' ? 'KYNOX WMS — منصة إدارة المستودعات' : 'KYNOX WMS — Warehouse Execution Platform';

    document.getElementById('app').innerHTML = `
      <main class="wms-landing" id="wms-landing">
        <header class="wl-header">
          <a class="wl-brand" href="#/landing" aria-label="WMS by KYNOX"><strong>WMS</strong><span>/</span><b>KYNOX</b></a>
          <nav aria-label="${locale === 'ar' ? 'التنقل الرئيسي' : 'Primary navigation'}">
            <button type="button" data-scroll="solution">${c.nav[0]}</button><button type="button" data-scroll="journey">${c.nav[1]}</button><button type="button" data-scroll="demo">${c.nav[2]}</button>
          </nav>
          <div class="wl-header-actions">
            ${Lang.available.includes('ar') ? `<button class="wl-language" type="button" data-landing-language aria-label="${locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}"><span class="${locale === 'ar' ? 'active' : ''}">AR</span><i></i><span class="${locale === 'en' ? 'active' : ''}">EN</span></button>` : ''}
            <a class="wl-button wl-button-secondary wl-signin" href="#/login"><i class="ph ph-sign-in" aria-hidden="true"></i>${c.signIn}</a>
          </div>
        </header>

        <section class="wl-hero" id="solution">
          <div class="wl-hero-copy"><p class="wl-eyebrow">${c.eyebrow}</p><h1>${c.title}</h1><p>${c.body}</p>
            <div class="wl-actions"><button class="wl-button wl-button-primary" type="button" data-scroll="journey">${c.explore}<i class="ph ${arrow}" aria-hidden="true"></i></button><a class="wl-button wl-button-secondary" href="#/login"><i class="ph ph-sign-in" aria-hidden="true"></i>${c.signIn}</a></div>
          </div>
          <div class="wl-hero-visual" aria-label="${c.proofEyebrow}"><figure class="wl-shot wl-shot-back"><img src="${this.demos.inbound.light}" alt="${c.alts.inbound}"></figure><figure class="wl-shot wl-shot-front"><img src="${this.demos.outbound.dark}" alt="${c.alts.outbound}"></figure></div>
        </section>

        <section class="wl-demo" id="demo"><div class="wl-heading"><p class="wl-eyebrow">${c.proofEyebrow}</p><h2>${c.proofTitle}</h2><p>${c.proofBody}</p></div>
          <div class="wl-demo-controls"><div class="wl-tabs" role="tablist" aria-label="${c.proofTitle}">${Object.keys(this.demos).map((key) => `<button type="button" role="tab" data-demo="${key}" aria-selected="${demo === key}">${c.tabs[key]}</button>`).join('')}</div><div class="wl-theme-picker" role="group" aria-label="${c.previewStyle}"><span>${c.previewStyle}</span><button type="button" data-slide-theme="light" aria-pressed="${slideTheme === 'light'}"><i class="ph ph-sun" aria-hidden="true"></i>${c.lightStyle}</button><button type="button" data-slide-theme="dark" aria-pressed="${slideTheme === 'dark'}"><i class="ph ph-moon" aria-hidden="true"></i>${c.darkStyle}</button></div></div>
          <div class="wl-demo-stage wl-demo-theme-${slideTheme}"><div class="wl-slide"><div class="wl-slide-meta"><span>${String(Object.keys(this.demos).indexOf(demo) + 1).padStart(2, '0')} / ${String(Object.keys(this.demos).length).padStart(2, '0')}</span><strong>${c.tabs[demo]}</strong><em><i class="ph ph-flask" aria-hidden="true"></i>${c.demoData}</em></div><div class="wl-demo-frame wl-demo-${demo}"><img src="${demoSource(demo)}" alt="${c.alts[demo]}"></div></div><ol class="wl-annotations">${c.notes[demo].map((note, index) => `<li><span>${index + 1}</span><strong>${note}</strong></li>`).join('')}</ol></div>
        </section>

        <section class="wl-journey" id="journey"><div class="wl-heading centered"><p class="wl-eyebrow">${c.journeyEyebrow}</p><h2>${c.journeyTitle}</h2></div>
          <ol class="wl-journey-steps">${c.journey.map((step, index) => `<li><span class="wl-phase">${c.phases[Math.floor(index / 2)]}</span><span class="wl-journey-icon"><i class="ph-duotone ${journeyIcons[index]}" aria-hidden="true"></i></span><small>${String(index + 1).padStart(2, '0')}</small><h3>${step[0]}</h3><p>${step[1]}</p></li>`).join('')}</ol>
        </section>

        <section class="wl-audiences"><h2>${c.designed}</h2><div>${c.audiences.map((audience, index) => `<article><i class="ph-duotone ${audienceIcons[index]}" aria-hidden="true"></i><span><h3>${audience[0]}</h3><p>${audience[1]}</p></span></article>`).join('')}</div></section>
        <section class="wl-final"><div><h2>${c.finalTitle}</h2><p>${c.finalBody}</p></div><div><button class="wl-button wl-button-primary" type="button" data-scroll="demo">${c.tour}<i class="ph ${arrow}" aria-hidden="true"></i></button><a class="wl-button wl-button-secondary" href="#/login">${c.signIn}<i class="ph ph-sign-in" aria-hidden="true"></i></a></div></section>
        <footer class="wl-footer"><div class="wl-brand"><strong>WMS</strong><span>/</span><b>KYNOX</b></div><p>${c.footer}</p></footer>
      </main>`;

    // The marketing page follows the product: it offers a language only when the
    // app can actually deliver it. Its Arabic copy deck is complete and stays in
    // this file, dormant — an Arabic page that leads into an English app sets an
    // expectation the product breaks in the first minute, which is the same
    // reason the in-app picker is hidden. Enabling 'ar' in i18n.js brings both
    // back together. See services note in docs/PRODUCT-CRITIQUE-2026-09-12.md.
    const langBtn = document.querySelector('[data-landing-language]');
    if (langBtn) langBtn.addEventListener('click', () => Lang.set(locale === 'ar' ? 'en' : 'ar'));
    document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => {
      this.activeDemo = button.dataset.demo;
      this.render();
      document.getElementById('demo').scrollIntoView({ block: 'start' });
    }));
    document.querySelectorAll('[data-slide-theme]').forEach((button) => button.addEventListener('click', () => {
      this.slideTheme = button.dataset.slideTheme;
      this.render();
      document.getElementById('demo').scrollIntoView({ block: 'start' });
    }));
  },
};
