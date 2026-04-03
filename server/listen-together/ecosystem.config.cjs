module.exports = {
  apps: [
    {
      name: 'echo-listen-together',
      script: './index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 8787
      }
    }
  ]
}
