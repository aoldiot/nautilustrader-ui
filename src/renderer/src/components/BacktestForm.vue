<script setup lang="ts">
import { ref } from 'vue'
import { Play, X } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'submit', params: {
    symbol: string
    startDate: string
    endDate: string
    initialCapital: number
    fastPeriod: number
    slowPeriod: number
  }): void
  (e: 'close'): void
}>()

const symbol = ref('BTC-USD')
const startDate = ref('2026-01-01')
const endDate = ref('2026-05-01')
const initialCapital = ref(100000)
const fastPeriod = ref(12)
const slowPeriod = ref(26)

const formError = ref<string | null>(null)

function handleSubmit() {
  formError.value = null
  
  if (!symbol.value.trim()) {
    formError.value = '请输入交易标的代码 (例如 BTC-USD 或 AAPL)'
    return
  }
  
  if (!startDate.value || !endDate.value) {
    formError.value = '请选择完整的开始与结束日期'
    return
  }
  
  if (new Date(startDate.value) >= new Date(endDate.value)) {
    formError.value = '开始日期必须早于结束日期'
    return
  }
  
  if (initialCapital.value <= 0) {
    formError.value = '初始资金必须大于 0'
    return
  }
  
  if (fastPeriod.value <= 0 || slowPeriod.value <= 0) {
    formError.value = '均线周期必须大于 0'
    return
  }
  
  if (fastPeriod.value >= slowPeriod.value) {
    formError.value = '快线周期必须小于慢线周期'
    return
  }

  emit('submit', {
    symbol: symbol.value.trim().toUpperCase(),
    startDate: startDate.value,
    endDate: endDate.value,
    initialCapital: initialCapital.value,
    fastPeriod: fastPeriod.value,
    slowPeriod: slowPeriod.value
  })
}
</script>

<template>
  <div class="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
    <div class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300">
      
      <!-- Header -->
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h3 class="text-sm font-bold text-slate-100 uppercase tracking-wider">新建策略回测任务</h3>
          <p class="text-[10px] text-slate-500 font-mono mt-0.5">Dual EMA/SMA Crossover Strategy • Subprocess Engine</p>
        </div>
        <button
          @click="emit('close')"
          class="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Form Body -->
      <form @submit.prevent="handleSubmit" class="p-6 flex-1 flex flex-col gap-4 text-xs">
        
        <!-- Error message -->
        <div v-if="formError" class="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-2.5 rounded-lg font-medium font-mono text-[11px]">
          {{ formError }}
        </div>

        <div class="grid grid-cols-2 gap-4">
          <!-- Symbol -->
          <div class="flex flex-col gap-1.5 col-span-2">
            <label class="font-bold text-slate-400 uppercase tracking-wider">交易标的代码 (Symbol)</label>
            <input
              v-model="symbol"
              type="text"
              class="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none transition"
              placeholder="e.g. BTC-USD, AAPL"
            />
          </div>

          <!-- Initial Capital -->
          <div class="flex flex-col gap-1.5 col-span-2">
            <label class="font-bold text-slate-400 uppercase tracking-wider">初始账户资金 (USD)</label>
            <input
              v-model.number="initialCapital"
              type="number"
              class="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none transition"
            />
          </div>

          <!-- Start Date -->
          <div class="flex flex-col gap-1.5">
            <label class="font-bold text-slate-400 uppercase tracking-wider">开始日期</label>
            <input
              v-model="startDate"
              type="date"
              class="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none transition"
            />
          </div>

          <!-- End Date -->
          <div class="flex flex-col gap-1.5">
            <label class="font-bold text-slate-400 uppercase tracking-wider">结束日期</label>
            <input
              v-model="endDate"
              type="date"
              class="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none transition"
            />
          </div>

          <!-- Fast Period -->
          <div class="flex flex-col gap-1.5">
            <label class="font-bold text-slate-400 uppercase tracking-wider">快均线周期 (Fast MA)</label>
            <input
              v-model.number="fastPeriod"
              type="number"
              class="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none transition"
            />
          </div>

          <!-- Slow Period -->
          <div class="flex flex-col gap-1.5">
            <label class="font-bold text-slate-400 uppercase tracking-wider">慢均线周期 (Slow MA)</label>
            <input
              v-model.number="slowPeriod"
              type="number"
              class="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-slate-100 font-mono outline-none transition"
            />
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="mt-4 pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            type="button"
            @click="emit('close')"
            class="px-4 py-2 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200 transition font-semibold"
          >
            取消
          </button>
          
          <button
            type="submit"
            class="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold shadow-lg hover:shadow-indigo-500/10 border border-indigo-500/50 hover:border-indigo-400/50 transition duration-200"
          >
            <Play class="w-3.5 h-3.5" />
            开始回测
          </button>
        </div>

      </form>
    </div>
  </div>
</template>
