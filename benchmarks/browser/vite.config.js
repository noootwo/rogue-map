
import { resolve } from 'path';

export default {
  resolve: {
    alias: {
      // Shim fs
      fs: resolve(__dirname, './mocks/fs.ts'),
      path: resolve(__dirname, './mocks/fs.ts'),
      // Force 'buffer' to resolve to the installed npm package
      buffer: 'buffer',
    }
  },
  define: {
    'process.env': {},
    'global': 'window',
  },
  optimizeDeps: {
    exclude: ['fs'],
    include: ['buffer']
  }
};
