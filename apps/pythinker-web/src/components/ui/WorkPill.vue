<script setup lang="ts">
import type { IconName } from '../../lib/icons';
import Icon from './Icon.vue';
import Pill from './Pill.vue';

defineProps<{
  icon: string;
  active?: boolean;
  label?: string;
}>();

defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <Pill
    :active="active"
    :aria-pressed="active"
    :aria-label="label"
    @click="$emit('click', $event)"
  >
    <Icon :name="icon as IconName" size="md" />
    <span><slot /></span>
    <slot name="meta" />
  </Pill>
</template>
