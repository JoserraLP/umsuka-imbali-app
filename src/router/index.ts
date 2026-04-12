import { createRouter, createWebHistory } from '@ionic/vue-router';
import LoginPage from '../views/LoginPage.vue';
import RegisterPage from '../views/RegisterPage.vue';

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', component: LoginPage },
  { path: '/register', component: RegisterPage }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router