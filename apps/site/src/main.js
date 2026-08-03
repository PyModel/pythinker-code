import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { registerWebMcpTools } from './webmcp';

createApp(App).mount('#app');
registerWebMcpTools();
