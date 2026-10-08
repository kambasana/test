import { makeDenyAdapter } from '../deny.mjs';
export const createServerAdapter = () => makeDenyAdapter('process');
