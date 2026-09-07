/** Public bilingual product landing page. Authentication remains at #/login. */
window.Pages = window.Pages || {};

Pages.landing = {
  activeDemo: 'control',

  copy: {
    en: {
      nav: ['Solution', 'Workflow', 'Demo'],
      signIn: 'Sign in',
      eyebrow: 'Warehouse operations and material control platform',
      title: 'One workspace connecting every material movement',
      body: 'From request and approval to receiving, picking, goods issue, and audit — WMS gives every team a clear, controlled path from need to stock movement.',
      explore: 'Explore the workflow',
      proofEyebrow: 'Screens from the working product',
      proofTitle: 'Operational control from request to warehouse execution',
      proofBody: 'Move between real WMS demonstration views and see how priorities, warehouse work, and traceability connect in one system.',
      tabs: { control: 'Operations control', mobile: 'Mobile execution', trace: 'Material network' },
      alts: { control: 'WMS operations control workspace', mobile: 'WMS mobile warehouse picking workflow', trace: 'Connected warehouse and logistics network' },
      notes: {
        control: ['Prioritized work in one queue', 'Clear ownership and service level', 'Decision history beside the task'],
        mobile: ['Task guidance for warehouse teams', 'Scan-driven location confirmation', 'Shortage handling inside the workflow'],
        trace: ['Connected warehouse movements', 'One source for material status', 'Traceability from receipt to issue'],
      },
      journeyEyebrow: 'A controlled warehouse journey',
      journeyTitle: 'From material need to traceable completion',
      journey: [
        ['Request and approve', 'Capture the requirement, validate quantities, and route the decision to the right approver.'],
        ['Allocate and assign', 'Reserve stock by warehouse, bin, and batch, then assign accountable operators.'],
        ['Pick, scan, and post', 'Guide physical execution with QR confirmation and controlled goods movement posting.'],
        ['Receive, count, and audit', 'Close the loop with receiving, cycle counts, exceptions, and a durable audit trail.'],
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
      proofEyebrow: 'شاشات من المنتج الفعلي',
      proofTitle: 'تحكم تشغيلي من الطلب حتى التنفيذ داخل المستودع',
      proofBody: 'تنقّل بين عروض توضيحية حقيقية من WMS وشاهد كيف تتصل الأولويات والتنفيذ والتتبع في نظام واحد.',
      tabs: { control: 'التحكم التشغيلي', mobile: 'التنفيذ الميداني', trace: 'شبكة المواد' },
      alts: { control: 'مساحة التحكم في عمليات WMS', mobile: 'رحلة الالتقاط الميدانية عبر WMS', trace: 'شبكة المستودعات والخدمات اللوجستية المترابطة' },
      notes: {
        control: ['أولوية العمل في قائمة واحدة', 'ملكية واضحة ومستوى خدمة محدد', 'سجل القرار بجوار المهمة'],
        mobile: ['توجيه واضح لفريق المستودع', 'تأكيد الموقع والمسح بالرمز', 'معالجة النقص داخل رحلة العمل'],
        trace: ['حركات مستودعات مترابطة', 'مصدر واحد لحالة المواد', 'تتبع من الاستلام حتى الصرف'],
      },
      journeyEyebrow: 'رحلة مستودع منضبطة',
      journeyTitle: 'من احتياج المواد حتى الإكمال القابل للتتبع',
      journey: [
        ['الطلب والاعتماد', 'تسجيل الاحتياج والتحقق من الكميات وتوجيه القرار إلى صاحب الصلاحية.'],
        ['الحجز والتكليف', 'حجز المخزون حسب المستودع والموقع والدفعة ثم تعيين المسؤول عن التنفيذ.'],
        ['الالتقاط والمسح والترحيل', 'توجيه التنفيذ الفعلي عبر QR وتأكيد المواقع وترحيل حركة المواد بضوابط واضحة.'],
        ['الاستلام والجرد والتدقيق', 'إغلاق الدورة بالاستلام والجرد الدوري والاستثناءات وسجل تدقيق موثوق.'],
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
    control: '/design-preview/kynox-redesign-preview-desktop.png',
    mobile: '/design-preview/kynox-redesign-preview-mobile.png',
    trace: '/img/hero-network.jpg',
  },

  render() {
    const locale = Lang.current === 'ar' ? 'ar' : 'en';
    const c = this.copy[locale];
    const arrow = locale === 'ar' ? 'ph-arrow-left' : 'ph-arrow-right';
    const journeyIcons = ['ph-clipboard-text', 'ph-package', 'ph-scan', 'ph-chart-line-up'];
    const audienceIcons = ['ph-warehouse', 'ph-hard-hat', 'ph-shield-check'];
    const demo = this.activeDemo;
    document.title = locale === 'ar' ? 'KYNOX WMS — منصة إدارة المستودعات' : 'KYNOX WMS — Warehouse Execution Platform';

    document.getElementById('app').innerHTML = `
      <main class="wms-landing" id="wms-landing">
        <header class="wl-header">
          <a class="wl-brand" href="#/landing" aria-label="WMS by KYNOX"><strong>WMS</strong><span>/</span><b>KYNOX</b></a>
          <nav aria-label="${locale === 'ar' ? 'التنقل الرئيسي' : 'Primary navigation'}">
            <button type="button" data-scroll="solution">${c.nav[0]}</button><button type="button" data-scroll="journey">${c.nav[1]}</button><button type="button" data-scroll="demo">${c.nav[2]}</button>
          </nav>
          <div class="wl-header-actions">
            <button class="wl-language" type="button" data-landing-language aria-label="${locale === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}"><span class="${locale === 'ar' ? 'active' : ''}">AR</span><i></i><span class="${locale === 'en' ? 'active' : ''}">EN</span></button>
            <a class="wl-button wl-button-secondary wl-signin" href="#/login"><i class="ph ph-sign-in" aria-hidden="true"></i>${c.signIn}</a>
          </div>
        </header>

        <section class="wl-hero" id="solution">
          <div class="wl-hero-copy"><p class="wl-eyebrow">${c.eyebrow}</p><h1>${c.title}</h1><p>${c.body}</p>
            <div class="wl-actions"><button class="wl-button wl-button-primary" type="button" data-scroll="journey">${c.explore}<i class="ph ${arrow}" aria-hidden="true"></i></button><a class="wl-button wl-button-secondary" href="#/login"><i class="ph ph-sign-in" aria-hidden="true"></i>${c.signIn}</a></div>
          </div>
          <div class="wl-hero-visual" aria-label="${c.proofEyebrow}"><figure class="wl-shot wl-shot-back"><img src="${this.demos.control}" alt="${c.alts.control}"></figure><figure class="wl-shot wl-shot-front"><img src="${this.demos.mobile}" alt="${c.alts.mobile}"></figure></div>
        </section>

        <section class="wl-demo" id="demo"><div class="wl-heading"><p class="wl-eyebrow">${c.proofEyebrow}</p><h2>${c.proofTitle}</h2><p>${c.proofBody}</p></div>
          <div class="wl-tabs" role="tablist" aria-label="${c.proofTitle}">${Object.keys(this.demos).map((key) => `<button type="button" role="tab" data-demo="${key}" aria-selected="${demo === key}">${c.tabs[key]}</button>`).join('')}</div>
          <div class="wl-demo-stage"><div class="wl-demo-frame wl-demo-${demo}"><img src="${this.demos[demo]}" alt="${c.alts[demo]}"></div><ol class="wl-annotations">${c.notes[demo].map((note, index) => `<li><span>${index + 1}</span><strong>${note}</strong></li>`).join('')}</ol></div>
        </section>

        <section class="wl-journey" id="journey"><div class="wl-heading centered"><p class="wl-eyebrow">${c.journeyEyebrow}</p><h2>${c.journeyTitle}</h2></div>
          <ol class="wl-journey-steps">${c.journey.map((step, index) => `<li><span class="wl-journey-icon"><i class="ph-duotone ${journeyIcons[index]}" aria-hidden="true"></i></span><small>${String(index + 1).padStart(2, '0')}</small><h3>${step[0]}</h3><p>${step[1]}</p></li>`).join('')}</ol>
        </section>

        <section class="wl-audiences"><h2>${c.designed}</h2><div>${c.audiences.map((audience, index) => `<article><i class="ph-duotone ${audienceIcons[index]}" aria-hidden="true"></i><span><h3>${audience[0]}</h3><p>${audience[1]}</p></span></article>`).join('')}</div></section>
        <section class="wl-final"><div><h2>${c.finalTitle}</h2><p>${c.finalBody}</p></div><div><button class="wl-button wl-button-primary" type="button" data-scroll="demo">${c.tour}<i class="ph ${arrow}" aria-hidden="true"></i></button><a class="wl-button wl-button-secondary" href="#/login">${c.signIn}<i class="ph ph-sign-in" aria-hidden="true"></i></a></div></section>
        <footer class="wl-footer"><div class="wl-brand"><strong>WMS</strong><span>/</span><b>KYNOX</b></div><p>${c.footer}</p></footer>
      </main>`;

    document.querySelector('[data-landing-language]').addEventListener('click', () => Lang.set(locale === 'ar' ? 'en' : 'ar'));
    document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => {
      document.getElementById(button.dataset.scroll).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.querySelectorAll('[data-demo]').forEach((button) => button.addEventListener('click', () => {
      this.activeDemo = button.dataset.demo;
      this.render();
      document.getElementById('demo').scrollIntoView({ block: 'start' });
    }));
  },
};
