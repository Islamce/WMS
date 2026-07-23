(() => {
  'use strict';

  const GROUPS = [
    {
      key: 'command',
      label: 'Command Center',
      routes: ['dashboard', 'kpi', 'notifications'],
    },
    {
      key: 'demand',
      label: 'Demand & Requests',
      routes: ['create-request', 'requests', 'approvals', 'erp-operator'],
    },
    {
      key: 'inbound',
      label: 'Inbound Operations',
      routes: ['receiving', 'qr-printing', 'quality', 'batches', 'expiry'],
    },
    {
      key: 'execution',
      label: 'Warehouse Execution',
      routes: ['warehouse', 'allocation', 'picker-assign', 'picking', 'reallocation'],
    },
    {
      key: 'outbound',
      label: 'Outbound Operations',
      routes: ['gi-posting', 'shipping'],
    },
    {
      key: 'inventory-control',
      label: 'Inventory Control',
      routes: ['physical-inventory', 'cycle-count', 'all-locations', 'empty-locations'],
    },
    {
      key: 'intelligence',
      label: 'Intelligence & Analytics',
      routes: ['ai'],
    },
    {
      key: 'master-integration',
      label: 'Master Data & Integration',
      routes: ['materials', 'locations', 'warehouses-master', 'bins-master', 'movement-types', 'import'],
    },
    {
      key: 'governance',
      label: 'Governance & Administration',
      routes: ['audit', 'users', 'permissions'],
    },
  ];

  const LABELS = {
    dashboard: 'Operations Overview',
    kpi: 'Performance Cockpit',
    notifications: 'Alerts & Notifications',
    'create-request': 'Create Material Request',
    requests: 'Request Work Queue',
    approvals: 'Approval Work Queue',
    'erp-operator': 'ERP Processing Queue',
    receiving: 'Goods Receipt & Identification',
    'qr-printing': 'QR & Label Printing',
    quality: 'Quality Inspection',
    batches: 'Batch Traceability',
    expiry: 'Shelf-life & Expiry Control',
    warehouse: 'Execution Control Board',
    allocation: 'Bin & Batch Allocation',
    'picker-assign': 'Work Assignment',
    picking: 'Picking Tasks',
    reallocation: 'Stock Reallocation',
    'gi-posting': 'Goods Issue Posting',
    shipping: 'Packing, Dispatch & Shipping',
    'physical-inventory': 'Physical Inventory',
    'cycle-count': 'Cycle Counting',
    'all-locations': 'Stock by Location',
    'empty-locations': 'Available Locations',
    ai: 'AI Inventory Intelligence',
    materials: 'Material Master',
    locations: 'Storage Location Master',
    'warehouses-master': 'Warehouse Master',
    'bins-master': 'Bin Master',
    'movement-types': 'Movement Type Configuration',
    import: 'Data Integration Center',
    audit: 'Audit & Traceability',
    users: 'User Administration',
    permissions: 'Roles & Permissions',
  };

  function routeOf(link) {
    const href = link.getAttribute('href') || '';
    return href.replace(/^#\//, '').split('/')[0];
  }

  function makeGroup(def, links, activeRoute) {
    const wrapper = document.createElement('div');
    wrapper.className = 'nav-group kynox-nav-group';
    wrapper.dataset.key = `v2-${def.key}`;

    const hasActive = def.routes.includes(activeRoute);
    const saved = localStorage.getItem(`wms_v2_group_${def.key}`);
    const isOpen = hasActive || saved !== 'closed';
    if (isOpen) wrapper.classList.add('open');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'nav-group-head';
    head.setAttribute('aria-expanded', String(isOpen));
    head.innerHTML = `<span class="kynox-module-mark" aria-hidden="true"></span><span class="lbl"></span><svg class="ico chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    head.querySelector('.lbl').textContent = def.label;

    const body = document.createElement('div');
    body.className = 'nav-group-body';
    def.routes.forEach((route) => {
      const link = links.get(route);
      if (!link) return;
      const label = link.querySelector('.lbl');
      if (label && LABELS[route] && label.textContent !== LABELS[route]) label.textContent = LABELS[route];
      const nextTitle = LABELS[route] || link.title;
      if (link.title !== nextTitle) link.title = nextTitle;
      body.appendChild(link);
    });

    head.addEventListener('click', () => {
      const open = wrapper.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
      localStorage.setItem(`wms_v2_group_${def.key}`, open ? 'open' : 'closed');
    });

    wrapper.append(head, body);
    return wrapper;
  }

  function enhanceNavigation() {
    const tree = document.querySelector('.nav-tree');
    if (!tree || tree.dataset.kynoxV2 === '1') return;

    const links = new Map();
    tree.querySelectorAll('a.nav-item[href^="#/"]').forEach((link) => {
      const route = routeOf(link);
      if (route && route !== 'home') links.set(route, link);
    });

    if (!links.size) return;

    const active = routeOf(tree.querySelector('a.nav-item.active') || document.createElement('a'));
    const home = tree.querySelector('a.nav-home');
    const fragment = document.createDocumentFragment();

    if (home) {
      const label = home.querySelector('.lbl');
      if (label && label.textContent !== 'Workspace Home') label.textContent = 'Workspace Home';
      fragment.appendChild(home);
    }

    GROUPS.forEach((group) => {
      if (group.routes.some((route) => links.has(route))) {
        fragment.appendChild(makeGroup(group, links, active));
      }
    });

    const unassigned = [...links.entries()].filter(([route]) => !GROUPS.some((g) => g.routes.includes(route)));
    if (unassigned.length) {
      const other = { key: 'other', label: 'Additional Operations', routes: unassigned.map(([route]) => route) };
      fragment.appendChild(makeGroup(other, links, active));
    }

    tree.replaceChildren(fragment);
    tree.dataset.kynoxV2 = '1';
  }

  function applyShellIdentity() {
    const brand = document.querySelector('.sidebar .brand-name');
    if (brand && brand.textContent !== 'KYNOX WMS') brand.textContent = 'KYNOX WMS';
    const mark = document.querySelector('.sidebar .brand-mark');
    if (mark && mark.textContent !== 'K') mark.textContent = 'K';
    if (!document.documentElement.classList.contains('kynox-v2')) {
      document.documentElement.classList.add('kynox-v2');
    }
  }

  const observer = new MutationObserver(() => {
    const tree = document.querySelector('.nav-tree');
    if (tree && tree.dataset.kynoxV2 !== '1') enhanceNavigation();
    applyShellIdentity();
  });

  observer.observe(document.getElementById('app'), { childList: true, subtree: true });
  enhanceNavigation();
  applyShellIdentity();
})();
