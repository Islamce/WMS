/** Public bilingual product landing page, written for a contractor's site store. Authentication remains at #/login. */
window.Pages = window.Pages || {};

Pages.landing = {
  activeDemo: 'control',
  slideTheme: 'light',

  copy: {
    en: {
      nav: ['Solution', 'Workflow', 'Demo'],
      signIn: 'Sign in',
      eyebrow: 'Site store control for contractors',
      title: 'Know what every project consumed, and who signed for it',
      body: 'From the engineer\u2019s request to the storekeeper\u2019s issue, KYNOX WMS records every bag, tonne and metre that leaves a site store \u2014 against a project, approved by someone other than the person who issued it. No ERP required.',
      explore: 'See the workflow',
      proofEyebrow: 'Product walkthrough',
      proofTitle: 'A site store, run with control instead of a notebook',
      proofBody: 'Move between the screens a contractor\u2019s store actually uses, on clearly hypothetical data. Light or dark presentation.',
      previewStyle: 'Preview style',
      lightStyle: 'Light',
      darkStyle: 'Dark',
      demoData: 'Hypothetical demo data',
      tabs: { control: 'Site store dashboard', inbound: 'Receiving & inspection', outbound: 'Issue to project', mobile: 'On the yard', trace: 'Project spend' },
      alts: { control: 'KYNOX WMS site store dashboard', inbound: 'KYNOX WMS delivery inspection screen', outbound: 'KYNOX WMS material issue queue', mobile: 'KYNOX WMS mobile picking on site', trace: 'Material consumption by project' },
      notes: {
        control: ['Stock on hand, per unit, per store', 'Requests waiting on an approval or a pick', 'Every exception with a name beside it'],
        inbound: ['Delivery note, batch and quantity at the gate', 'Held until the engineer accepts it', 'Subcontractor-owned material kept apart'],
        outbound: ['Issued against a project, never loose', 'The approver cannot be the issuer', 'Issue document and audit line in one step'],
        mobile: ['Claim, pick and confirm from a phone', 'Scan the batch where it sits', 'Shortages recorded, not hidden'],
        trace: ['What each project consumed this month', 'Which requests it came from', 'Reversals netted off, not counted twice'],
      },
      journeyEyebrow: 'The site store workflow',
      journeyTitle: 'Eight controls from the engineer\u2019s request to the monthly report',
      phases: ['Demand', 'Inbound', 'Execution', 'Control'],
      journey: [
        ['Request against a project', 'The site engineer asks for material by project, quantity and required date \u2014 from a register, so no project is spelt two ways.'],
        ['Approve, by someone else', 'The responsible engineer approves the quantity. Segregation of duties stops the same person approving and issuing.'],
        ['Receive at the gate', 'Record the delivery note, batch and quantity as the truck arrives. Subcontractor deliveries are received as theirs, not yours.'],
        ['Inspect, then release', 'New stock is held until it is accepted against the project\u2019s specification. Nothing on hold can be issued.'],
        ['Put away and pick', 'Stock is placed in a yard or rack, and the storekeeper picks it from where it sits \u2014 oldest or nearest-to-expiry first.'],
        ['Issue and sign', 'The issue is posted against the request with a document number, by a different person from the approver.'],
        ['Count and reconcile', 'Cycle counts are posted by a second user, and subcontractor custody is reconciled against what they were given.'],
        ['Report by project', 'Consumption per project, per month, with the requests behind each figure \u2014 the report the store exists to produce.'],
      ],
      designed: 'Built for the people who run a contractor\u2019s store',
      audiences: [
        ['Site storekeepers', 'Receive, release, pick and issue from one screen or one phone, with the rules enforced rather than remembered.'],
        ['Project and site engineers', 'Raise a request in a minute and see exactly where it is, without walking to the store to ask.'],
        ['Owners and project control', 'Spend by project, who approved what, and a refusal on record every time someone tried to issue to themselves.'],
      ],
      finalTitle: 'See a request go from the engineer to the yard',
      finalBody: 'A ten-minute walk-through: receive a delivery, release it, request it back out, and watch the control refuse the wrong person.',
      tour: 'Start the walkthrough',
      footer: 'WMS by KYNOX \u2014 site store control for contractors: every issue against a project, every approval by a second pair of hands.',
    },
    ar: {
      nav: ['الحل', 'رحلة العمل', 'العرض'],
      signIn: 'تسجيل الدخول',
      eyebrow: 'ضبط مخازن المواقع لشركات المقاولات',
      title: 'اعرف ماذا استهلك كل مشروع، ومن وقّع عليه',
      body: 'من طلب المهندس إلى صرف أمين المخزن، يسجل KYNOX WMS كل شيكارة وطن ومتر يخرج من مخزن الموقع — على مشروع محدد، وباعتماد شخص غير الذي صرفه. بدون الحاجة إلى ERP.',
      explore: 'شاهد رحلة العمل',
      proofEyebrow: 'جولة في المنتج',
      proofTitle: 'مخزن موقع يُدار بضبط بدلاً من الدفتر',
      proofBody: 'تنقّل بين الشاشات التي يستخدمها مخزن المقاول فعلاً، ببيانات افتراضية بالكامل، بالعرض الفاتح أو الداكن.',
      previewStyle: 'نمط العرض',
      lightStyle: 'فاتح',
      darkStyle: 'داكن',
      demoData: 'بيانات افتراضية للعرض',
      tabs: { control: 'لوحة مخزن الموقع', inbound: 'الاستلام والفحص', outbound: 'الصرف على المشروع', mobile: 'في الساحة', trace: 'استهلاك المشاريع' },
      alts: { control: 'لوحة مخزن الموقع في KYNOX WMS', inbound: 'شاشة فحص التوريدات في KYNOX WMS', outbound: 'قائمة صرف المواد في KYNOX WMS', mobile: 'الالتقاط من الهاتف في الموقع عبر KYNOX WMS', trace: 'استهلاك المواد حسب المشروع' },
      notes: {
        control: ['المخزون الحالي لكل وحدة ولكل مخزن', 'الطلبات المنتظرة اعتماداً أو التقاطاً', 'كل استثناء وبجواره اسم المسؤول'],
        inbound: ['إذن التوريد والدفعة والكمية عند البوابة', 'محجوز حتى يقبله المهندس', 'مواد مقاول الباطن مفصولة عن موادك'],
        outbound: ['صرف على مشروع، لا صرف سائب', 'المعتمِد لا يمكن أن يكون الصارف', 'مستند الصرف وسطر التدقيق في خطوة واحدة'],
        mobile: ['استلام المهمة والالتقاط والتأكيد من الهاتف', 'مسح الدفعة من مكانها', 'تسجيل النقص لا إخفاؤه'],
        trace: ['ماذا استهلك كل مشروع هذا الشهر', 'ومن أي طلبات جاء', 'المرتجعات تُخصم ولا تُحسب مرتين'],
      },
      journeyEyebrow: 'رحلة عمل مخزن الموقع',
      journeyTitle: 'ثماني نقاط ضبط من طلب المهندس حتى التقرير الشهري',
      phases: ['الطلب', 'الاستلام', 'التنفيذ', 'الرقابة'],
      journey: [
        ['طلب على مشروع', 'يطلب مهندس الموقع المواد بالمشروع والكمية والتاريخ المطلوب — من سجل ثابت، فلا يُكتب مشروع بطريقتين.'],
        ['اعتماد من شخص آخر', 'يعتمد المهندس المسؤول الكمية. فصل المهام يمنع أن يعتمد الشخص نفسه ويصرف.'],
        ['استلام عند البوابة', 'تسجيل إذن التوريد والدفعة والكمية مع وصول السيارة. توريدات مقاول الباطن تُستلم باسمه لا باسمك.'],
        ['فحص ثم إفراج', 'المخزون الجديد محجوز حتى يُقبل وفق مواصفات المشروع. لا يُصرف شيء وهو محجوز.'],
        ['تخزين والتقاط', 'توضع المواد في ساحة أو رف، ويلتقطها أمين المخزن من مكانها — الأقدم أو الأقرب للانتهاء أولاً.'],
        ['صرف وتوقيع', 'يُرحّل الصرف على الطلب برقم مستند، بواسطة شخص غير المعتمِد.'],
        ['جرد ومطابقة', 'يُرحّل الجرد الدوري بواسطة مستخدم ثانٍ، وتُطابق عهدة مقاول الباطن بما سُلّم له.'],
        ['تقرير حسب المشروع', 'الاستهلاك لكل مشروع لكل شهر مع الطلبات وراء كل رقم — التقرير الذي وُجد المخزن لينتجه.'],
      ],
      designed: 'مصمم لمن يديرون مخزن المقاول فعلاً',
      audiences: [
        ['أمناء مخازن المواقع', 'استلام وإفراج والتقاط وصرف من شاشة واحدة أو هاتف واحد، بقواعد يفرضها النظام لا الذاكرة.'],
        ['مهندسو المشاريع والمواقع', 'طلب في دقيقة، ومعرفة موضعه بالضبط دون المشي إلى المخزن للسؤال.'],
        ['الملاك ومراقبة المشاريع', 'الإنفاق حسب المشروع، ومن اعتمد ماذا، ورفض مسجل في كل مرة حاول فيها أحد الصرف لنفسه.'],
      ],
      finalTitle: 'شاهد طلباً ينتقل من المهندس إلى الساحة',
      finalBody: 'جولة عشر دقائق: استلم توريداً، أفرج عنه، اطلبه مرة أخرى، وشاهد النظام يرفض الشخص الخطأ.',
      tour: 'ابدأ الجولة',
      footer: 'WMS من KYNOX — ضبط مخازن المواقع للمقاولين: كل صرف على مشروع، وكل اعتماد بيد ثانية.',
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
