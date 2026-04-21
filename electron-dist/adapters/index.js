import { NodeAdapter } from './node.js';
import { PythonAdapter } from './python.js';
import { GoAdapter } from './go.js';
import { RustAdapter } from './rust.js';
export function allAdapters() {
    return [new PythonAdapter(), new NodeAdapter(), new GoAdapter(), new RustAdapter()];
}
export function getAdapter(name) {
    const adapter = allAdapters().find(a => a.name === name);
    if (!adapter)
        throw new Error(`unknown language: ${name}`);
    return adapter;
}
export * from './base.js';
//# sourceMappingURL=index.js.map