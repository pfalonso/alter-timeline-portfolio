import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // Solo se excluyen el composition root y los ficheros que únicamente declaran tipos.
      exclude: [
        'src/main.ts',
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/domain/model/LifeData.ts',
        'src/domain/model/Category.ts',
        'src/application/ports/**',
        'src/infrastructure/three/SceneEffect.ts',
        'src/infrastructure/three/types.ts',
      ],
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
  },
});
