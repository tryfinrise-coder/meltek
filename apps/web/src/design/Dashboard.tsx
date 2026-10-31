import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { HiArrowRight, HiOutlineCalculator, HiOutlineCollection, HiOutlineAdjustments, HiPlus } from 'react-icons/hi';
import { api } from '../shared/api';
import { Badge, Button, Card, EmptyState, Skeleton } from '../shared/primitives';
import { useCurrentUser, usePermission } from '../auth/session';
import { useReference } from './useCalculator';
import { CoreIllustration } from '../shared/CoreIllustration';

export function Dashboard() {
  const user = useCurrentUser();
  const canCreate = usePermission('designs.create');
  const reference = useReference();
  const recent = useQuery({ queryKey: ['designs', 'dashboard'], queryFn: () => api.designs({ limit: 8 }) });
  const rows = [...(recent.data?.designs ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const pending = reference.data?.settingRows.filter(row => !row.isConfirmed).length ?? 0;
  const actions = [
    { to: '/calculator', icon: HiOutlineCalculator, title: 'Explore a specification', description: 'Compare steel grades, wire combinations and material costs.', label: 'Open calculator' },
    { to: '/register', icon: HiOutlineCollection, title: 'Continue a saved design', description: 'Review revisions, approvals and the selected construction.', label: 'Browse register' },
    { to: '/admin', icon: HiOutlineAdjustments, title: 'Keep your data current', description: 'Maintain material rates, process settings and customer records.', label: 'Reference data' },
  ];
  return <div className="workspace-home">
    <div className="home-welcome"><span className="eyebrow">MELTEK / ENGINEERING WORKSPACE</span><span>Welcome{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</span></div>
    <section className="home-hero">
      <div className="home-hero-copy">
        <span className="home-kicker"><span /> LT CURRENT TRANSFORMER DESIGN</span>
        <h1>Every detail.<br /><em>One workspace.</em></h1>
        <p>Turn an electrical specification into a considered core and winding design. Calculate, compare and keep every decision together.</p>
        <div className="home-hero-actions">
          <Link to={canCreate ? '/design/new' : '/calculator'} className="action-link action-primary"><HiPlus aria-hidden />{canCreate ? 'Create a design' : 'Open calculator'}<HiArrowRight aria-hidden /></Link>
          <Link to="/register" className="action-link action-secondary">View saved designs</Link>
        </div>
        <div className="home-capabilities"><span>Electrical sizing</span><span>Winding analysis</span><span>Live 3D model</span></div>
      </div>
      <div className="home-hero-art"><CoreIllustration /><div className="home-art-label"><span>LT CT / RING CORE</span><span>SPECIFICATION → CONSTRUCTION</span></div></div>
    </section>
    <section className="home-metrics" aria-label="Workspace reference data">
      {[['Steel grades', reference.data?.grades.length, 'Materials in your reference library'], ['Available gauges', reference.data?.gauges.filter(g => g.isAvailable).length, 'Wire sizes enabled for calculation'], ['Customers', reference.data?.customers.length, 'Customer records on file'], ['Settings to review', reference.data ? pending : undefined, 'Process values awaiting confirmation']].map(([label, value, detail]) => <div key={String(label)}><span>{label}</span>{reference.isLoading ? <Skeleton className="h-8 w-16" /> : <strong className="num">{value ?? '—'}</strong>}<small>{detail}</small></div>)}
    </section>
    {reference.isError && <div className="workspace-notice" role="alert">Reference data could not be loaded.<Button size="sm" onClick={() => { void reference.refetch(); }}>Try again</Button></div>}
    <section className="home-action-grid" aria-label="Workspace tools">{actions.map(({ to, icon: Icon, title, description, label }, index) => <Link to={to} key={to} className="home-tool-card"><div className="home-tool-top"><Icon aria-hidden /><span className="num">0{index + 1}</span></div><h2>{title}</h2><p>{description}</p><span className="home-tool-link">{label}<HiArrowRight aria-hidden /></span></Link>)}</section>
    <Card className="home-recent" title="Recent designs" subtitle="Your latest saved specifications and revisions" actions={<Link to="/register" className="text-link">View register <HiArrowRight aria-hidden /></Link>}>
      {recent.isLoading && <div className="p-5 flex flex-col gap-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      {recent.isError && <EmptyState title="Designs could not be loaded"><p className="mb-4">Check your connection and try again.</p><Button onClick={() => { void recent.refetch(); }}>Reload designs</Button></EmptyState>}
      {recent.isSuccess && rows.length === 0 && <EmptyState title="Your first design starts here"><p className="mb-4">Save a specification from the calculator to build your design library.</p><Link to="/design/new" className="text-link">Open the design calculator <HiArrowRight aria-hidden /></Link></EmptyState>}
      <div className="recent-design-list">{rows.map(d => <Link key={d.id} to="/designs/$id" params={{ id: d.id }} className="recent-design-row"><span className="recent-design-icon"><HiOutlineCollection aria-hidden /></span><span className="recent-design-name"><strong>{d.designNo}</strong><small>{d.customerName}</small></span><span className="recent-design-spec num">{d.inputs.primaryCurrent}/{d.inputs.secondaryCurrent} A<small>{d.inputs.burdenVA} VA · Class {d.inputs.accuracyClass}</small></span><Badge tone={d.status === 'approved' || d.status === 'in_production' ? 'ok' : 'neutral'}>{d.status.replaceAll('_', ' ')}</Badge><HiArrowRight className="recent-design-arrow" aria-hidden /></Link>)}</div>
    </Card>
    <footer className="home-footer"><span>MELTEK DESIGN WORKSPACE</span><span>Specifications. Calculations. Traceability.</span></footer>
  </div>;
}
