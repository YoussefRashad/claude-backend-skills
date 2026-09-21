import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Base for every entity.
 *
 * Standard: .ai/standards/01-engineering-standards.md §7.
 *
 * WHAT THIS PROVIDES — state it accurately in .ai/standards/03-project-architecture.md and keep
 * that statement true. A base class described as providing something it does not is
 * how an entity ends up shipped with no primary key.
 *
 *   - `id`         uuid, generated
 *   - `createdAt`  timestamptz
 *   - `updatedAt`  timestamptz
 *
 * It does NOT provide soft delete. Add `@DeleteDateColumn({ type: 'timestamptz' })`
 * on the entities that need it (§7) and apply it consistently across that table's
 * access paths — raw SQL does not inherit the ORM's implicit filter.
 */
export abstract class AbstractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
