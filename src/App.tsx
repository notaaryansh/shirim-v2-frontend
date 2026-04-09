import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { Home, Compass, Download, Settings, ChevronRight, Search, ArrowUpRight } from 'lucide-react';
import './index.css';

const MOCK_PROJECTS_BY_CATEGORY: Record<string, { id: number; name: string; desc: string; language: string; stars: string }[]> = {
  Popular: [
    { id: 101, name: 'next.js', desc: 'The React Framework for the Web', language: 'TypeScript', stars: '118k' },
    { id: 102, name: 'react', desc: 'A JavaScript library for building user interfaces', language: 'JavaScript', stars: '224k' },
    { id: 103, name: 'vue', desc: 'The Progressive JavaScript Framework', language: 'TypeScript', stars: '207k' },
    { id: 104, name: 'svelte', desc: 'Cybernetically enhanced web apps', language: 'TypeScript', stars: '78k' },
    { id: 105, name: 'astro', desc: 'The web framework for content-driven sites', language: 'TypeScript', stars: '44k' },
    { id: 106, name: 'remix', desc: 'Build better websites with web standards', language: 'TypeScript', stars: '29k' },
    { id: 107, name: 'nuxt', desc: 'The Intuitive Vue Framework', language: 'TypeScript', stars: '54k' },
    { id: 108, name: 'solid', desc: 'Simple and performant reactivity', language: 'TypeScript', stars: '31k' },
  ],
  Productivity: [
    { id: 201, name: 'obsidian-git', desc: 'Sync your vault with a git repository', language: 'TypeScript', stars: '3.4k' },
    { id: 202, name: 'logseq', desc: 'Privacy-first, open-source knowledge base', language: 'Clojure', stars: '34k' },
    { id: 203, name: 'excalidraw', desc: 'Virtual whiteboard for sketching diagrams', language: 'TypeScript', stars: '82k' },
    { id: 204, name: 'taskwarrior', desc: 'Command-line task management', language: 'C++', stars: '4.1k' },
    { id: 205, name: 'timewarrior', desc: 'Command-line time tracking', language: 'C++', stars: '2.0k' },
    { id: 206, name: 'super-productivity', desc: 'To-do list & time tracker for devs', language: 'TypeScript', stars: '11k' },
    { id: 207, name: 'appflowy', desc: 'Open-source Notion alternative', language: 'Rust', stars: '55k' },
    { id: 208, name: 'affine', desc: 'Next-gen knowledge base', language: 'TypeScript', stars: '38k' },
  ],
  AI: [
    { id: 301, name: 'llama.cpp', desc: 'LLM inference in pure C/C++', language: 'C++', stars: '68k' },
    { id: 302, name: 'ollama', desc: 'Get up and running with LLMs locally', language: 'Go', stars: '89k' },
    { id: 303, name: 'open-webui', desc: 'User-friendly AI interface', language: 'Svelte', stars: '51k' },
    { id: 304, name: 'comfyui', desc: 'Node-based stable diffusion UI', language: 'Python', stars: '52k' },
    { id: 305, name: 'langchain', desc: 'Build apps with LLMs through composability', language: 'Python', stars: '94k' },
    { id: 306, name: 'fabric', desc: 'AI augmentation framework', language: 'Go', stars: '23k' },
    { id: 307, name: 'gpt-engineer', desc: 'Specify what you want, AI builds it', language: 'Python', stars: '52k' },
    { id: 308, name: 'stable-diffusion', desc: 'Latent text-to-image diffusion model', language: 'Python', stars: '66k' },
  ],
  Trending: [
    { id: 401, name: 'bun', desc: 'Fast all-in-one JavaScript runtime', language: 'Zig', stars: '72k' },
    { id: 402, name: 'deno', desc: 'A modern runtime for JavaScript and TypeScript', language: 'Rust', stars: '95k' },
    { id: 403, name: 'tauri', desc: 'Build smaller, faster desktop apps', language: 'Rust', stars: '80k' },
    { id: 404, name: 'hono', desc: 'Web framework built on web standards', language: 'TypeScript', stars: '18k' },
    { id: 405, name: 'drizzle-orm', desc: 'TypeScript ORM that feels like writing SQL', language: 'TypeScript', stars: '22k' },
    { id: 406, name: 'shadcn-ui', desc: 'Beautifully designed components', language: 'TypeScript', stars: '72k' },
    { id: 407, name: 'zod', desc: 'TypeScript-first schema validation', language: 'TypeScript', stars: '33k' },
    { id: 408, name: 'trpc', desc: 'End-to-end typesafe APIs made easy', language: 'TypeScript', stars: '34k' },
  ],
  'Recently Run': [
    { id: 501, name: 'budget-view', desc: 'Minimalistic personal finance dashboard', language: 'Rust', stars: '4.2k' },
    { id: 502, name: 'llm-eval', desc: 'Evaluate open source language models', language: 'Python', stars: '12k' },
    { id: 503, name: 'react-three-fiber', desc: 'React renderer for Three.js', language: 'TypeScript', stars: '24k' },
    { id: 504, name: 'postgres-wasm', desc: 'PostgreSQL running in WebAssembly', language: 'C', stars: '8k' },
    { id: 505, name: 'terminal-ui', desc: 'Build rich TUIs in the terminal', language: 'Rust', stars: '6.3k' },
    { id: 506, name: 'my-portfolio', desc: 'Personal site built with Astro', language: 'TypeScript', stars: '0' },
    { id: 507, name: 'shirim-docs', desc: 'Documentation for Shirim', language: 'Markdown', stars: '0' },
    { id: 508, name: 'finance-tracker', desc: 'Track your expenses locally', language: 'Go', stars: '1.1k' },
  ],
};

const VIEW_CATEGORIES: Record<'Home' | 'Discover' | 'Installed' | 'Settings', string[]> = {
  Home: ['Popular', 'Recently Run'],
  Discover: ['Productivity', 'AI', 'Trending'],
  Installed: [],
  Settings: [],
};

export default function App() {
  const [activeView, setActiveView] = useState<'Home' | 'Discover' | 'Installed' | 'Settings'>('Home');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchHint, setShowSearchHint] = useState(false);
  
  // Runtime Panel State
  const [activeProject, setActiveProject] = useState(null);
  const [status, setStatus] = useState('IDLE'); // IDLE, BUILDING, RUNNING
  const [logs, setLogs] = useState([]);
  
  const logEndRef = useRef(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Debounce the "press enter to search" hint — only surface it 400ms after the user stops typing.
  useEffect(() => {
    if (searchQuery.length === 0) {
      setShowSearchHint(false);
      return;
    }
    setShowSearchHint(false);
    const t = setTimeout(() => setShowSearchHint(true), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleRun = (project) => {
    setActiveProject(project);
    setStatus('BUILDING');
    setLogs([]);
    
    const buildSequence = [
      `> Fetching repository ${project.name}... ✓`,
      `> resolving dependencies (npm install) ...`,
      `✓ done in 1.2s`,
      `> configuring environment for ${project.language}...`,
      `✓ environment set up`,
      `> starting dev server...`,
      `> Listening on http://localhost:3000`
    ];

    let step = 0;
    const interval = setInterval(() => {
      if (step < buildSequence.length) {
        setLogs(prev => [...prev, buildSequence[step]]);
        step++;
      } else {
        clearInterval(interval);
        setStatus('RUNNING');
      }
    }, 450); // 450ms per log line for dramatic effect
  };

  const closePanel = () => {
    setActiveProject(null);
    setStatus('IDLE');
    setLogs([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: 'var(--bg)', color: 'var(--text-primary)', overflow: 'hidden' }}>

      {/* DRAG REGION — makes the top strip draggable like a native titlebar */}
      <div style={{
        height: '32px',
        flexShrink: 0,
        WebkitAppRegion: 'drag',
        backgroundColor: 'var(--bg)'
      } as CSSProperties} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* 1. LEFT SIDEBAR */}
      <div style={{ 
        width: '260px', 
        backgroundColor: 'var(--surface)', 
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 16px',
        flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent)', letterSpacing: '-0.02em', marginBottom: '40px', paddingLeft: '8px' }}>
          SHIRIM
        </div>

        {/* Main Nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <NavItem icon={<Home size={18} />} label="Home" active={activeView === 'Home'} onClick={() => setActiveView('Home')} />
          <NavItem icon={<Compass size={18} />} label="Discover" active={activeView === 'Discover'} onClick={() => setActiveView('Discover')} />
          <NavItem icon={<Download size={18} />} label="Installed" active={activeView === 'Installed'} onClick={() => setActiveView('Installed')} />
        </div>

        {/* Bottom Nav */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <NavItem icon={<Settings size={18} />} label="Settings" active={activeView === 'Settings'} onClick={() => setActiveView('Settings')} />
        </div>
      </div>

      {/* 2. MAIN CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Top Header / Search — hidden on Installed and Settings */}
        {(activeView === 'Home' || activeView === 'Discover') && (
        <div style={{ padding: '32px 40px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                backgroundColor: 'var(--surface-2)', 
                border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: searchFocused ? '0 0 0 3px var(--accent-glow)' : 'none',
                borderRadius: '100px',
                padding: '12px 20px',
                transition: 'all 120ms ease-out'
              }}>
              <Search size={18} color="var(--text-muted)" style={{ marginRight: '12px' }} />
              <input
                placeholder="search for apps, tools, repos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-pixel)', fontSize: '15px', width: '100%'
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
              <span style={{
                color: 'var(--text-muted)',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                letterSpacing: '0.02em',
                overflow: 'hidden',
                maxWidth: showSearchHint ? '220px' : '0px',
                marginLeft: showSearchHint ? '12px' : '0px',
                opacity: showSearchHint ? 1 : 0,
                transform: showSearchHint ? 'translateX(0)' : 'translateX(6px)',
                transition: 'max-width 260ms ease-out, margin-left 260ms ease-out, opacity 200ms ease-out, transform 260ms ease-out',
                pointerEvents: 'none'
              }}>
                press <kbd style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  margin: '0 2px'
                }}>enter</kbd> to search
              </span>
            </div>
          </div>

        </div>
        )}

        {/* Category Sections — each is a horizontally scrollable 2×n grid */}
        <div style={{ flex: 1, padding: '24px 0 40px', overflowY: 'auto' }}>
          {VIEW_CATEGORIES[activeView].length === 0 && (
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: '13px',
              padding: '40px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {activeView === 'Installed' ? 'Nothing installed yet' : 'Settings'}
              </div>
              <div>
                {activeView === 'Installed'
                  ? 'Repositories you run will appear here.'
                  : 'Configuration options coming soon.'}
              </div>
            </div>
          )}
          {VIEW_CATEGORIES[activeView].map(cat => (
            <div key={cat} style={{ marginBottom: '40px' }}>
              <div style={{
                padding: '0 40px',
                marginBottom: '16px',
                color: 'var(--text-muted)',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em'
              }}>
                {cat}
              </div>

              <div className="hide-scrollbar" style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                containerType: 'inline-size'
              } as CSSProperties}>
                <div style={{
                  display: 'grid',
                  gridTemplateRows: 'repeat(2, 220px)',
                  gridAutoFlow: 'column',
                  gridAutoColumns: 'calc((100cqw - 96px) / 2)',
                  gap: '16px',
                  padding: '0 40px'
                }}>
                  {MOCK_PROJECTS_BY_CATEGORY[cat].map(proj => (
                    <ProjectCard key={proj.id} project={proj} onRun={() => handleRun(proj)} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* 3. RIGHT SIDEBAR (Runtime Panel) */}
      {activeProject && (
        <div className="fade-in" style={{ 
          width: '380px', 
          backgroundColor: 'var(--surface)', 
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          {/* Panel Header */}
          <div style={{ padding: '24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: '500', marginBottom: '8px' }}>{activeProject.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <span style={{ 
                  width: '8px', height: '8px', borderRadius: '50%', 
                  backgroundColor: status === 'RUNNING' ? 'var(--running)' : status === 'BUILDING' ? 'var(--building)' : 'var(--error)',
                  animation: status === 'BUILDING' ? 'pulse-dot 1.5s infinite' : 'none'
                }} />
                <span style={{ color: status === 'RUNNING' ? 'var(--running)' : status === 'BUILDING' ? 'var(--building)' : 'var(--error)', letterSpacing: '0.05em' }}>
                  {status}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>|</span>
                <span style={{ color: 'var(--text-secondary)' }}>{activeProject.language}</span>
              </div>
            </div>
            <button onClick={closePanel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Terminal View */}
          <div style={{ flex: 1, backgroundColor: '#080807', padding: '16px', borderBottom: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FF5F56' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FFBD2E' }} />
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#27C93F' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '12px', textTransform: 'uppercase' }}>bash / {activeProject.name}</span>
            </div>
            
            <div style={{ fontSize: '13px', lineHeight: '1.7', color: 'var(--text-primary)', wordBreak: 'break-all' }}>
              {logs.map((log, i) => (
                <div key={i} style={{ marginBottom: '4px' }}>
                  {log}
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ color: 'var(--accent)' }}>❯ </span>
                <span className="terminal-cursor" style={{ marginLeft: '6px', width: '8px', height: '14px', backgroundColor: 'var(--accent)', display: 'inline-block' }} />
              </div>
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Bottom Actions */}
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button disabled={status !== 'RUNNING'} style={{
              width: '100%',
              padding: '12px',
              borderRadius: '6px',
              border: 'none',
              background: status === 'RUNNING' ? 'linear-gradient(135deg, #F5F1E6 0%, #D9D3C2 100%)' : 'var(--surface-2)',
              color: status === 'RUNNING' ? '#0A0A09' : 'var(--text-muted)',
              fontWeight: 'bold',
              fontFamily: 'var(--font-pixel)',
              fontSize: '15px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              cursor: status === 'RUNNING' ? 'pointer' : 'not-allowed',
              transition: 'all 150ms'
            }}>
              Open App <ArrowUpRight size={16} />
            </button>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button style={{
                  flex: 1, padding: '10px', background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-pixel)', cursor: 'pointer', fontSize: '13px'
              }}>View Logs</button>
              
              <button onClick={() => setStatus('IDLE')} style={{
                  flex: 1, padding: '10px', background: 'transparent',
                  border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--error)',
                  fontFamily: 'var(--font-pixel)', cursor: 'pointer', fontSize: '13px'
              }}>Stop</button>
            </div>
          </div>
          
        </div>
      )}

      </div>
    </div>
  );
}


function NavItem({ icon, label, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 12px',
        borderRadius: '6px',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        backgroundColor: active ? 'var(--accent-glow)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 120ms ease-out'
      }}
      onMouseEnter={(e) => {
        if(!active) {
          e.currentTarget.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if(!active) {
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
      }}>
      {icon}
      <span style={{ fontSize: '15px' }}>{label}</span>
    </div>
  );
}


function ProjectCard({ project, onRun }) {
  const [hover, setHover] = useState(false);
  const imageUrl = `https://picsum.photos/seed/${encodeURIComponent(project.name)}/600/240?grayscale`;

  return (
    <div
      className="glow-hover"
      onClick={onRun}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        backgroundColor: hover ? '#1E1E20' : 'var(--surface-2)',
        border: `1px solid ${hover ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
        cursor: 'pointer',
        overflow: 'hidden'
      }}
    >
      {/* Banner image */}
      <div style={{
        width: '100%',
        height: '100px',
        backgroundImage: `linear-gradient(180deg, rgba(10,10,9,0) 60%, rgba(10,10,9,0.7) 100%), url(${imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)'
      }} />

      {/* Content */}
      <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{project.name}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '12px' }}>
            <span style={{ color: 'var(--accent)' }}>★</span> {project.stars}
          </div>
        </div>

        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '12px',
          lineHeight: '1.5',
          marginBottom: '12px',
          flex: 1,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        } as CSSProperties}>
          {project.desc}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            backgroundColor: 'var(--surface)', padding: '4px 8px', borderRadius: '4px',
            fontSize: '11px', color: 'var(--text-secondary)'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-dim)' }} />
            {project.language}
          </div>
        </div>
      </div>
    </div>
  );
}
