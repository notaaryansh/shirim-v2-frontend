import {
  useState, useEffect, useMemo, useRef,
} from 'react';
import {
  Search, ChevronRight, ChevronDown, Play, Clock, Calendar,
  Copy, Check, Info, AlertTriangle, Sparkles, ArrowRight, ArrowLeft,
  BookOpen,
} from 'lucide-react';
import {
  DOCS, findArticle, nextArticle, prevArticle,
  type Article, type Block, type TopicGroup,
} from './tutorial';

/* ------------------------- MAIN EXPORT ------------------------- */

export default function TutorialPage() {
  const firstSlug = DOCS[0].articles[0].slug;
  const [activeSlug, setActiveSlug] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('shirim-tutorial-last-article');
      if (stored && findArticle(stored)) return stored;
    } catch {}
    return firstSlug;
  });

  useEffect(() => {
    try { localStorage.setItem('shirim-tutorial-last-article', activeSlug); } catch {}
  }, [activeSlug]);

  const article = findArticle(activeSlug);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <DocsSidebar activeSlug={activeSlug} onSelect={setActiveSlug} />
      <ArticleView
        key={activeSlug}
        article={article}
        onNavigate={setActiveSlug}
      />
    </div>
  );
}

/* ------------------------- SIDEBAR ------------------------- */

function DocsSidebar({
  activeSlug, onSelect,
}: {
  activeSlug: string;
  onSelect: (slug: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filteredGroups = useMemo<TopicGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCS;
    return DOCS
      .map(group => ({
        ...group,
        articles: group.articles.filter(a =>
          a.title.toLowerCase().includes(q) ||
          a.subtitle.toLowerCase().includes(q)
        ),
      }))
      .filter(group => group.articles.length > 0);
  }, [query]);

  return (
    <div style={{
      width: '280px', flexShrink: 0,
      backgroundColor: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 20px 14px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <BookOpen size={16} style={{ color: 'var(--text-secondary)' }} />
          <h2 style={{
            fontSize: '14px', fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
          }}>
            Documentation
          </h2>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '7px 10px',
          backgroundColor: 'var(--surface-2)',
          border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
          boxShadow: focused ? '0 0 0 3px var(--accent-glow)' : 'none',
          borderRadius: '6px',
          transition: 'all 120ms ease-out',
        }}>
          <Search size={13} color="var(--text-muted)" />
          <input
            placeholder="search docs..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{
              flex: 1,
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-pixel)', fontSize: '12px',
            }}
          />
        </div>
      </div>

      {/* Nav tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 8px 24px' }}>
        {filteredGroups.length === 0 ? (
          <div style={{
            padding: '28px 16px', textAlign: 'center',
            color: 'var(--text-muted)', fontSize: '12px',
            fontFamily: 'var(--font-pixel)',
          }}>
            No results for "{query}".
          </div>
        ) : (
          filteredGroups.map(group => {
            const isCollapsed = !!collapsed[group.id] && !query;
            return (
              <div key={group.id} style={{ marginBottom: '6px' }}>
                <button
                  onClick={() => setCollapsed(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '8px 10px',
                    background: 'transparent', border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '11px', fontWeight: 600,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    borderRadius: '5px',
                    transition: 'color 120ms ease-out',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  <span>{group.title}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: '10px',
                    color: 'var(--text-muted)', fontWeight: 400,
                    letterSpacing: '0.02em', textTransform: 'none',
                  }}>
                    {group.articles.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div style={{ paddingLeft: '17px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                    {group.articles.map(article => (
                      <ArticleLink
                        key={article.slug}
                        article={article}
                        active={article.slug === activeSlug}
                        onClick={() => onSelect(article.slug)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ArticleLink({
  article, active, onClick,
}: {
  article: Article;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '6px 10px',
        background: active ? 'var(--accent-glow)' : 'transparent',
        border: 'none',
        borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
        color: active ? 'var(--text-primary)' : hovered ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-pixel)',
        fontSize: '12px',
        cursor: 'pointer',
        borderRadius: '0 5px 5px 0',
        transition: 'all 120ms ease-out',
        fontWeight: active ? 500 : 400,
      }}
    >
      {article.title}
    </button>
  );
}

/* ------------------------- ARTICLE VIEW ------------------------- */

function ArticleView({
  article, onNavigate,
}: {
  article: Article | null;
  onNavigate: (slug: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Scroll the article back to top whenever we navigate to a new one.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [article?.slug]);

  if (!article) {
    return (
      <div style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
        Article not found.
      </div>
    );
  }

  const prev = prevArticle(article.slug);
  const next = nextArticle(article.slug);

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--bg)' }}>
      <article className="fade-in" style={{
        maxWidth: '760px',
        margin: '0 auto',
        padding: '56px 48px 80px',
      }}>
        {/* Breadcrumb */}
        <div style={{
          fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-muted)', fontWeight: 600,
          marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <span>{article.category}</span>
          <ChevronRight size={10} />
          <span style={{ color: 'var(--text-secondary)' }}>{article.title}</span>
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: '34px', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.025em', lineHeight: 1.15,
          marginBottom: '10px',
        }}>
          {article.title}
        </h1>
        <p style={{
          fontSize: '16px', color: 'var(--text-secondary)',
          lineHeight: 1.55,
          marginBottom: '18px',
        }}>
          {article.subtitle}
        </p>

        {/* Meta row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          paddingBottom: '22px', marginBottom: '32px',
          borderBottom: '1px solid var(--border)',
          fontSize: '12px', color: 'var(--text-muted)',
          fontFamily: 'var(--font-pixel)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Clock size={11} /> {article.readingTime}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <Calendar size={11} /> Updated {article.updated}
          </span>
        </div>

        {/* Blocks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {article.blocks.map((block, i) => (
            <BlockRenderer key={i} block={block} />
          ))}
        </div>

        {/* Prev / next footer */}
        <div style={{
          marginTop: '60px', paddingTop: '28px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: '12px',
        }}>
          {prev ? (
            <NavCard
              direction="prev"
              label="Previous"
              title={prev.title}
              onClick={() => onNavigate(prev.slug)}
            />
          ) : <div style={{ flex: 1 }} />}
          {next ? (
            <NavCard
              direction="next"
              label="Next"
              title={next.title}
              onClick={() => onNavigate(next.slug)}
            />
          ) : <div style={{ flex: 1 }} />}
        </div>
      </article>
    </div>
  );
}

function NavCard({
  direction, label, title, onClick,
}: {
  direction: 'prev' | 'next';
  label: string;
  title: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isPrev = direction === 'prev';
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        cursor: 'pointer',
        background: hovered ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '8px',
        padding: '14px 18px',
        textAlign: isPrev ? 'left' : 'right',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-pixel)',
        transition: 'all 140ms ease-out',
        display: 'flex', flexDirection: 'column', gap: '4px',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        fontSize: '10.5px',
        color: 'var(--text-muted)',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        fontWeight: 600,
        justifyContent: isPrev ? 'flex-start' : 'flex-end',
      }}>
        {isPrev && <ArrowLeft size={11} style={{ transform: hovered ? 'translateX(-2px)' : 'translateX(0)', transition: 'transform 140ms ease-out' }} />}
        {label}
        {!isPrev && <ArrowRight size={11} style={{ transform: hovered ? 'translateX(2px)' : 'translateX(0)', transition: 'transform 140ms ease-out' }} />}
      </span>
      <span style={{ fontSize: '14px', fontWeight: 500, letterSpacing: '-0.01em' }}>{title}</span>
    </button>
  );
}

/* ------------------------- BLOCK RENDERERS ------------------------- */

function BlockRenderer({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':    return <HeadingBlock level={block.level} text={block.text} />;
    case 'paragraph':  return <ParagraphBlock body={block.body} />;
    case 'code':       return <CodeBlock lang={block.lang} code={block.code} />;
    case 'video':      return <VideoBlock caption={block.caption} duration={block.duration} />;
    case 'callout':    return <CalloutBlock variant={block.variant} body={block.body} />;
    case 'list':       return <ListBlock ordered={block.ordered} items={block.items} />;
    case 'image':      return <ImageBlock caption={block.caption} accent={block.accent} />;
    case 'divider':    return <DividerBlock />;
  }
}

function HeadingBlock({ level, text }: { level: 2 | 3; text: string }) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (level === 2) {
    return (
      <h2 id={slug} style={{
        fontSize: '22px', fontWeight: 600,
        color: 'var(--text-primary)',
        letterSpacing: '-0.015em',
        marginTop: '20px',
        marginBottom: '-6px',
        scrollMarginTop: '24px',
      }}>
        {text}
      </h2>
    );
  }
  return (
    <h3 id={slug} style={{
      fontSize: '16px', fontWeight: 600,
      color: 'var(--text-primary)',
      letterSpacing: '-0.01em',
      marginTop: '10px',
      marginBottom: '-6px',
      scrollMarginTop: '24px',
    }}>
      {text}
    </h3>
  );
}

function ParagraphBlock({ body }: { body: string }) {
  return (
    <p style={{
      fontSize: '14.5px', color: 'var(--text-secondary)',
      lineHeight: 1.7,
      fontFamily: 'var(--font-pixel)',
    }}>
      {body}
    </p>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <div style={{
      position: 'relative',
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        fontSize: '10.5px',
        color: 'var(--text-muted)',
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-pixel)',
        textTransform: 'uppercase',
      }}>
        <span>{lang}</span>
        <button
          onClick={handleCopy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            background: 'transparent', border: 'none',
            color: copied ? 'var(--running)' : 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-pixel)',
            fontSize: '10px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            padding: '3px 6px',
            borderRadius: '4px',
            transition: 'color 120ms ease-out',
          }}
          onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'var(--text-primary)'; }}
          onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre style={{
        margin: 0,
        padding: '14px 16px',
        fontFamily: 'var(--font-pixel)',
        fontSize: '12.5px',
        color: 'var(--text-primary)',
        lineHeight: 1.6,
        overflowX: 'auto',
        whiteSpace: 'pre',
      }}>
        {code}
      </pre>
    </div>
  );
}

function VideoBlock({ caption, duration }: { caption: string; duration: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <figure style={{ margin: 0 }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          aspectRatio: '16 / 9',
          borderRadius: '10px',
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: 'linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%)',
          cursor: 'pointer',
          transition: 'transform 200ms ease-out, border-color 200ms ease-out',
          transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
          borderColor: hovered ? 'var(--border-active)' : 'var(--border)',
        }}
      >
        {/* Checkered / stripe backdrop */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 18px, rgba(255,255,255,0.02) 18px 20px)',
        }} />

        {/* Subtle centered glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(circle at 50% 50%, var(--accent-glow) 0%, transparent 60%)',
          opacity: hovered ? 1 : 0.6,
          transition: 'opacity 200ms ease-out',
        }} />

        {/* Play button */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--on-accent)',
            boxShadow: hovered
              ? '0 0 0 6px var(--accent-glow), 0 10px 28px rgba(0,0,0,0.35)'
              : '0 4px 14px rgba(0,0,0,0.2)',
            transform: hovered ? 'scale(1.08)' : 'scale(1)',
            transition: 'all 220ms ease-out',
          }}>
            <Play size={24} fill="currentColor" style={{ marginLeft: '3px' }} />
          </div>
        </div>

        {/* Duration badge */}
        <div style={{
          position: 'absolute', right: 12, bottom: 12,
          padding: '3px 8px',
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: '#fff',
          borderRadius: '4px',
          fontSize: '11px',
          fontFamily: 'var(--font-pixel)',
          letterSpacing: '0.02em',
        }}>
          {duration}
        </div>
      </div>
      <figcaption style={{
        marginTop: '10px',
        fontSize: '12px',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-pixel)',
        textAlign: 'center',
      }}>
        {caption}
      </figcaption>
    </figure>
  );
}

function CalloutBlock({ variant, body }: { variant: 'tip' | 'warning' | 'note'; body: string }) {
  const theme = {
    tip:     { color: 'var(--building)',  icon: <Sparkles size={14} />,        label: 'TIP' },
    warning: { color: 'var(--error)',     icon: <AlertTriangle size={14} />,   label: 'WARNING' },
    note:    { color: 'var(--accent-dim)', icon: <Info size={14} />,           label: 'NOTE' },
  }[variant];

  return (
    <div style={{
      display: 'flex', gap: '12px',
      padding: '14px 16px 14px 18px',
      backgroundColor: 'var(--surface-2)',
      borderLeft: `3px solid ${theme.color}`,
      borderRadius: '0 8px 8px 0',
    }}>
      <span style={{
        color: theme.color,
        display: 'flex', alignItems: 'flex-start', paddingTop: '2px',
        flexShrink: 0,
      }}>
        {theme.icon}
      </span>
      <div>
        <div style={{
          fontSize: '10px', letterSpacing: '0.1em',
          color: theme.color, fontWeight: 600,
          marginBottom: '5px',
          fontFamily: 'var(--font-pixel)',
        }}>
          {theme.label}
        </div>
        <div style={{
          fontSize: '13.5px', color: 'var(--text-secondary)',
          lineHeight: 1.6, fontFamily: 'var(--font-pixel)',
        }}>
          {body}
        </div>
      </div>
    </div>
  );
}

function ListBlock({ ordered, items }: { ordered: boolean; items: string[] }) {
  const Tag = (ordered ? 'ol' : 'ul') as 'ol' | 'ul';
  return (
    <Tag style={{
      paddingLeft: '22px',
      margin: 0,
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-pixel)',
      fontSize: '14px',
      lineHeight: 1.75,
    }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: '6px' }}>{item}</li>
      ))}
    </Tag>
  );
}

function ImageBlock({ caption, accent }: { caption: string; accent: 'yellow' | 'blue' | 'neutral' }) {
  const gradient = {
    yellow:  'linear-gradient(135deg, rgba(255, 213, 87, 0.16) 0%, rgba(255, 213, 87, 0.03) 100%)',
    blue:    'linear-gradient(135deg, rgba(107, 157, 255, 0.16) 0%, rgba(107, 157, 255, 0.03) 100%)',
    neutral: 'linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%)',
  }[accent];

  return (
    <figure style={{ margin: 0 }}>
      <div style={{
        position: 'relative',
        aspectRatio: '16 / 9',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: gradient,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 14px, rgba(255,255,255,0.02) 14px 16px)',
        }} />
        <div style={{
          position: 'relative', textAlign: 'center',
          fontFamily: 'var(--font-pixel)',
        }}>
          <div style={{
            fontSize: '10px', letterSpacing: '0.1em',
            color: 'var(--text-muted)', textTransform: 'uppercase',
            marginBottom: '6px',
          }}>
            Screenshot
          </div>
          <div style={{
            fontSize: '13px', color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}>
            {caption}
          </div>
        </div>
      </div>
      <figcaption style={{
        marginTop: '10px',
        fontSize: '12px',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-pixel)',
        textAlign: 'center',
      }}>
        {caption}
      </figcaption>
    </figure>
  );
}

function DividerBlock() {
  return (
    <hr style={{
      border: 'none',
      borderTop: '1px solid var(--border)',
      margin: '10px 0',
    }} />
  );
}

// Allow downstream type imports from this module.
export type { Article, Block };
