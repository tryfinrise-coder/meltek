import { Link } from '@tanstack/react-router';
import { HiOutlineCalculator, HiOutlineDocumentAdd, HiOutlineCollection } from 'react-icons/hi';
import { Wordmark } from '../shared/Shell';

function ActionCard({
  to, icon: Icon, title, description,
}: {
  to: string; icon: typeof HiOutlineCalculator; title: string; description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-8 text-center transition-all hover:border-[var(--brand)] hover:shadow-lg"
    >
      <Icon className="h-10 w-10 text-[var(--text-3)] transition-colors group-hover:text-[var(--brand)]" />
      <span className="text-lg font-semibold text-[var(--text)]">{title}</span>
      <span className="text-sm leading-relaxed text-[var(--text-2)]">{description}</span>
    </Link>
  );
}

export function Dashboard() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-10 py-12">
      <div className="flex flex-col items-center gap-2">
        <Wordmark size={32} />
        <p className="text-sm text-[var(--text-2)]">LT current transformer core design</p>
      </div>

      <div className="grid w-full gap-6 sm:grid-cols-3">
        <ActionCard
          to="/calculator"
          icon={HiOutlineCalculator}
          title="Calculator"
          description="Quick calculation without saving. Enter specs and see all options."
        />
        <ActionCard
          to="/design/new"
          icon={HiOutlineDocumentAdd}
          title="New Design"
          description="Create a design with customer details, calculate and save to the register."
        />
        <ActionCard
          to="/register"
          icon={HiOutlineCollection}
          title="Design Register"
          description="Browse saved designs, review calculations and print sheets."
        />
      </div>
    </div>
  );
}
