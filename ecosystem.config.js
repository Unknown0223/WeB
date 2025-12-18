module.exports = {
  apps: [{
    name: 'web-app',
    script: './server.js',
    // WebSocket va real-time funksiyalar uchun fork rejimi (cluster emas)
    // Cluster rejimi WebSocket bilan muammo qilishi mumkin
    instances: 1, // WebSocket uchun 1 instance yaxshiroq
    exec_mode: 'fork', // Fork rejimi - WebSocket uchun mos
    autorestart: true, // Avtomatik qayta ishga tushirish
    watch: false, // Production da watch o'chirilgan
    max_memory_restart: '1G', // 1GB dan oshsa qayta ishga tushirish
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'error'
    },
    // Log sozlamalari
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true, // Loglarda vaqt ko'rsatish
    merge_logs: true, // Barcha instance loglarini birlashtirish
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    // Log rotation
    log_type: 'json', // JSON formatida log
    max_size: '10M', // Har bir log fayli maksimal hajmi
    retain: 10, // Saqlanadigan log fayllari soni
    
    // Restart sozlamalari
    min_uptime: '10s', // Minimal ish vaqti
    max_restarts: 10, // Maksimal qayta ishga tushirishlar soni
    restart_delay: 4000, // Qayta ishga tushirish orasidagi vaqt (ms)
    exp_backoff_restart_delay: 100, // Exponential backoff delay
    
    // Graceful shutdown
    kill_timeout: 10000, // Shutdown uchun vaqt (ms) - WebSocket ulanishlarini yopish uchun
    wait_ready: true, // Server tayyor bo'lishini kutish
    listen_timeout: 15000, // Server ishga tushish vaqti (ms)
    
    // Performance monitoring
    pmx: true, // PM2 monitoring
    instance_var: 'INSTANCE_ID',
    
    // Node.js optimizatsiyalari
    node_args: [
      '--max-old-space-size=1024', // Memory limit
      '--optimize-for-size' // Size optimizatsiyasi
    ],
    
    // Cron restart (har kuni ertalab 3:00 da - ixtiyoriy)
    // cron_restart: '0 3 * * *',
    
    // Ignore watch patterns (production uchun)
    ignore_watch: [
      'node_modules',
      'logs',
      '*.db',
      '*.log'
    ]
  }]
};

