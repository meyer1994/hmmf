<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  link: [{ rel: 'icon', href: '/favicon.ico' }],
  htmlAttrs: { lang: 'en' }
})
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="flex items-center gap-2 font-semibold text-highlighted"
        >
          <UIcon
            name="i-lucide-binary"
            class="size-5 text-primary"
          />
          HMMF
        </NuxtLink>
      </template>

      <template #right>
        <UButton
          to="/"
          color="neutral"
          variant="ghost"
          icon="i-lucide-house"
        >
          Home
        </UButton>
        <UButton
          to="/demo"
          color="neutral"
          variant="ghost"
          icon="i-lucide-flask-conical"
        >
          Demo
        </UButton>
        <UBadge
          color="neutral"
          variant="subtle"
        >
          Client-held keys
        </UBadge>
        <UColorModeButton />
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>
  </UApp>
</template>
