<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Register</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-input v-model="email" label="Email" type="email"></ion-input>
      <ion-input v-model="password" label="Password" type="password"></ion-input>

      <ion-button expand="block" @click="registerUser">Register</ion-button>
      <ion-button fill="clear" @click="$router.push('/login')">Back to Login</ion-button>
    </ion-content>
  </ion-page>
</template>

<script setup>
import { ref } from 'vue'
import { supabase } from '../services/supabase'

const email = ref('')
const password = ref('')

const registerUser = async () => {
  const { error } = await supabase.auth.signUp({
    email: email.value,
    password: password.value
  })

  if (error) {
    console.error(error.message)
    alert(error.message)
    return
  }

  alert('Registration successful')
}
</script>