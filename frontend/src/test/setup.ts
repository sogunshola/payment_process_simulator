import '@testing-library/jest-dom/vitest';

// jsdom has no 2D canvas; returning null silences its "not implemented" noise and
// the Arena canvas already treats a missing context as "nothing to draw".
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
