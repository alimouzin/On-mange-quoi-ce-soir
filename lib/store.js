import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = { meals: [], plan: [], checked: [] };

export class Store {
  constructor(file) {
    this.file = file;
    this.data = null;
    this.queue = Promise.resolve();
  }

  async load() {
    try {
      this.data = { ...EMPTY, ...JSON.parse(await fs.readFile(this.file, 'utf8')) };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.data = structuredClone(EMPTY);
    }
    return this;
  }

  /** Écritures sérialisées, atomiques (fichier temporaire + rename). */
  save() {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }
}
