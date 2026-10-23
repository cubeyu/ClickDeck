import type { CollaborationReviewItem } from "./collaboration-review";
import { proposedValueSignature } from "./collaboration-pending";

const version = (item: CollaborationReviewItem): string => JSON.stringify([
  item.task.kind, item.task.property, item.task.attribute, item.task.after, proposedValueSignature(item.task)
]);

// Consent is scoped to one project/member and the exact proposed value.
// Never auto-select new proposals or carry approval over an edited value.
export class CollaborationSharingSelection {
  private scope = "";
  private choices = new Map<string, string>();

  sync(scope: string, items: CollaborationReviewItem[]): void {
    if (scope !== this.scope) { this.scope = scope; this.choices.clear(); }
    const versions = new Map(items.map(item => [item.id, version(item)]));
    for (const [id, version] of this.choices) if (versions.get(id) !== version) this.choices.delete(id);
  }

  choose(item: CollaborationReviewItem, checked: boolean): void {
    if (checked) this.choices.set(item.id, version(item));
    else this.choices.delete(item.id);
  }

  has(item: CollaborationReviewItem): boolean {
    return this.choices.get(item.id) === version(item);
  }

  selected(items: CollaborationReviewItem[]): CollaborationReviewItem[] {
    return items.filter(item => this.has(item));
  }
}
