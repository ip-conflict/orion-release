module.exports = {
  apps: [
    {
      name: "Orion",
      script: "src/server.js",
      cwd: "./",
      instances: 1, 
      watch: false,
      max_memory_restart: "1G",
      
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },

      log_file: "./logs/app.log",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
