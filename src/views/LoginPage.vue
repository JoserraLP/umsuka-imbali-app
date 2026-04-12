<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Login</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-input v-model="email" label="Email" type="email"></ion-input>
      <ion-input v-model="password" label="Password" type="password"></ion-input>

      <ion-button expand="block" @click="loginUser">Login</ion-button>
      <ion-button fill="clear" @click="$router.push('/register')">Go to Register</ion-button>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { ref } from 'vue'
import { supabase } from '../services/supabase'

const email = ref('')
const password = ref('')

const loginUser = async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.value,
    password: password.value
  })

  if (error) {
    console.error(error.message)
    alert(error.message)
    return
  }

  alert('Login successful')
}
</script>