// The GitHub build never stores files locally; see local.js for the artifact build.
export function createLocalClient() { throw new Error('local storage client is artifact-only') }
