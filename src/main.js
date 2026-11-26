/**
 * Entry point for the T-34-85 Top-Down Tank Simulator.
 */
import { Game } from './game.js?v=25';

async function bootstrap() {
  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);

  try {
    await game.init();
    game.start();
  } catch (err) {
    console.error('Failed to initialize T-34-85 simulator:', err);
  }
}

window.addEventListener('DOMContentLoaded', bootstrap);
