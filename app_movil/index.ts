// Primero: globales de WebRTC de LiveKit para el probador en vivo (no hace nada en Expo Go)
import './src/tryOn/livekitBootstrap';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
