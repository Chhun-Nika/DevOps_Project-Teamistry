type TagColor = 'yellow' | 'pink' | 'lavender' | 'purple';

interface Card {
  title: string;
  tag: string;
  color: TagColor;
}

const columns: { name: string; count: number; done?: boolean; cards: Card[] }[] = [
  {
    name: 'To do', count: 3, cards: [
      { title: 'Write launch copy', tag: 'Marketing', color: 'yellow' },
      { title: 'Fix login bug', tag: 'Bug', color: 'pink' },
      { title: 'Plan Q1 roadmap', tag: 'Product', color: 'lavender' },
    ],
  },
  {
    name: 'In progress', count: 2, cards: [
      { title: 'Design onboarding', tag: 'Design', color: 'lavender' },
      { title: 'Update API docs', tag: 'Dev', color: 'yellow' },
    ],
  },
  {
    name: 'Done', count: 4, done: true, cards: [
      { title: 'Set up workspace', tag: 'Admin', color: 'yellow' },
      { title: 'Invite the team', tag: 'Team', color: 'pink' },
    ],
  },
];

const draggedCard: Card = { title: 'Review pull request', tag: 'Dev', color: 'purple' };

function PreviewCard({ card, dragged = false }: { card: Card; dragged?: boolean }) {
  return (
    <div className={dragged ? 'preview-card preview-card--dragged' : 'preview-card'}>
      <p className="preview-card-title">{card.title}</p>
      <span className={`preview-tag preview-tag--${card.color}`}>{card.tag}</span>
    </div>
  );
}

export function BoardPreview() {
  return (
    <aside className="auth-marketing" aria-label="About Teamisty">
      <p className="auth-marketing-title">Every task, one board.</p>
      <p className="auth-marketing-copy">Plan, move and finish work with your team, card by card.</p>
      <div className="board-preview" aria-hidden="true">
        {columns.map(column => (
          <div key={column.name} className="preview-column" data-done={column.done}>
            <div className="preview-column-heading">
              <span>{column.name}</span>
              <span>{column.count}</span>
            </div>
            {column.cards.map(card => <PreviewCard key={card.title} card={card} />)}
          </div>
        ))}
        <PreviewCard card={draggedCard} dragged />
      </div>
    </aside>
  );
}
