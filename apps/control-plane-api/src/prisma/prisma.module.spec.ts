import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../app.module';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

type ModuleClass = abstract new (...args: never[]) => unknown;

function collectModules(root: ModuleClass, seen = new Set<ModuleClass>()) {
  if (seen.has(root)) return seen;
  seen.add(root);
  const imports: unknown[] =
    Reflect.getMetadata(MODULE_METADATA.IMPORTS, root) ?? [];
  for (const entry of imports) {
    const mod =
      typeof entry === 'function'
        ? (entry as ModuleClass)
        : (entry as { module?: ModuleClass })?.module;
    if (mod) collectModules(mod, seen);
  }
  return seen;
}

describe('PrismaModule', () => {
  it('is the only module that provides PrismaService (single connection pool)', () => {
    const providers = [...collectModules(AppModule)].filter((mod) =>
      (
        (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, mod) ?? []) as unknown[]
      ).includes(PrismaService),
    );
    expect(providers).toEqual([PrismaModule]);
  });

  it('is global and exports PrismaService', () => {
    expect(Reflect.getMetadata('__module:global__', PrismaModule)).toBe(true);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, PrismaModule)).toEqual([
      PrismaService,
    ]);
  });
});
