// -------------------- system prompt --------------------
export const EDIT_SYSTEM_PROMPT = `You are an expert frontend developer and designer. Your job is to modify
a running application according to the user's instructions.

You have access to the project's source code and can read, edit, and
create files. The app is already installed and running — your changes
will be picked up by hot-reload.

{framework_section}

## Project context
{app_context}

## Rules
1. Work ONLY inside the working directory. Never cd out of it.
2. Make targeted, minimal edits. Prefer editing existing files over creating new ones.
3. After each edit, verify the change didn't break the build by checking for errors.
4. Keep the existing code style and conventions.
5. If the user asks for a visual change, focus on the component that renders that part.
6. If you need to install a new package, use the project's package manager.
7. NEVER delete files unless explicitly asked.
8. NEVER modify package.json dependencies unless necessary for the requested change.
9. When adding new components, follow the project's existing patterns.
10. For styling changes, use the project's existing styling approach.
`;
export const REMOTION_SECTION = `## Remotion-specific guidance
- This is a Remotion video project. Compositions are defined in src/Root.tsx or similar.
- Each composition has an id, width, height, fps, and durationInFrames.
- Use useCurrentFrame() and useVideoConfig() hooks for animation.
- The <Sequence> component controls timing of elements.
- Use interpolate() for smooth animations between keyframes.
- spring() creates natural motion with physics-based easing.
- AbsoluteFill is the standard container for full-frame content.
- Test changes with the Remotion preview player (already running).
- When modifying animations, keep frame-based timing in mind.
`;
export const GENERIC_SECTION = `## General guidance
- This is a web application. Changes should be reflected in the browser.
- Focus on the specific components or pages the user mentions.
- Use the existing design system and component library if one is present.
- For layout changes, check for existing layout components first.
- For new features, follow the project's routing and state management patterns.
`;
// -------------------- prompt builder --------------------
function formatAppContext(ctx) {
    const lines = [];
    lines.push(`- Project type: ${ctx.projectType}`);
    if (ctx.framework)
        lines.push(`- Framework: ${ctx.framework}`);
    if (ctx.styling)
        lines.push(`- Styling: ${ctx.styling}`);
    if (ctx.uiLibrary)
        lines.push(`- UI library: ${ctx.uiLibrary}`);
    lines.push(`- TypeScript: ${ctx.typescript ? 'yes' : 'no'}`);
    if (ctx.components.length > 0) {
        lines.push(`- Components (${ctx.components.length}):`);
        for (const comp of ctx.components.slice(0, 20)) {
            lines.push(`  - ${comp}`);
        }
        if (ctx.components.length > 20) {
            lines.push(`  - ... and ${ctx.components.length - 20} more`);
        }
    }
    if (ctx.keyFiles.length > 0) {
        lines.push(`- Key files:`);
        for (const f of ctx.keyFiles) {
            lines.push(`  - ${f}`);
        }
    }
    if (ctx.remotion && ctx.remotionCompositions.length > 0) {
        lines.push(`- Remotion compositions:`);
        for (const comp of ctx.remotionCompositions) {
            lines.push(`  - ${comp}`);
        }
    }
    return lines.join('\n');
}
export function buildEditSystemPrompt(appContext) {
    const frameworkSection = appContext.remotion
        ? REMOTION_SECTION
        : GENERIC_SECTION;
    const appContextStr = formatAppContext(appContext);
    return EDIT_SYSTEM_PROMPT
        .replace('{framework_section}', frameworkSection)
        .replace('{app_context}', appContextStr);
}
// -------------------- tool schemas (no report_success / report_failure) --------------------
export const EDIT_TOOL_SCHEMAS = [
    {
        type: 'function',
        function: {
            name: 'bash',
            description: 'Run a shell command in the working directory. Use for installing packages, ' +
                'checking build errors, or running project scripts. Output is trimmed to 4KB.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'The shell command to run.' },
                    timeout: {
                        type: 'integer',
                        description: 'Timeout in seconds (default 60, max 300).',
                    },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read a file from the working directory. Trimmed to 8KB.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Relative path to the file.' },
                },
                required: ['path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List the contents of a directory inside the working directory.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: "Relative path. Defaults to '.'.",
                    },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Make a targeted edit: replace a unique substring in a file. ' +
                'old_string must match EXACTLY ONCE. If zero matches, the tool ' +
                'returns closest_matches. If multiple matches, it returns ' +
                'match_lines so you can add context. Do NOT use this to rewrite ' +
                'whole files — use create_file for new files.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    old_string: {
                        type: 'string',
                        description: 'Exact substring to find. Must be unique.',
                    },
                    new_string: {
                        type: 'string',
                        description: 'Replacement text.',
                    },
                },
                required: ['path', 'old_string', 'new_string'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_file',
            description: 'Create a new file with the given content. Fails if the file ' +
                'already exists — use edit_file for existing files.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' },
                },
                required: ['path', 'content'],
            },
        },
    },
];
//# sourceMappingURL=edit-prompts.js.map