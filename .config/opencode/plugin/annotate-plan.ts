// Local plugin: opencode-plan-annotator
// This plugin imports from a local project checkout and is workstation-specific.
// It is NOT loaded by the shared opencode.jsonc — add it back in a machine-local
// override config if you have the project checked out locally.
//
// See: .config/opencode/opencode.local.example.jsonc

const home = process.env.HOME;
const { default: serverModule } = await import(
  `file://${home}/projects/opencode-annotator.nvim/dist/index.js`
);
export default serverModule;
