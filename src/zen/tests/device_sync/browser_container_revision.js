/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_space_container_revision() {
  await gZenWorkspaces.promiseInitialized;
  const { ContextualIdentityService } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs"
  );
  const first = ContextualIdentityService.create("Sync A", "fingerprint", "blue");
  const second = ContextualIdentityService.create("Sync B", "fingerprint", "red");
  const space = await gZenWorkspaces.createAndSaveWorkspace(
    "Container revision test",
    undefined,
    false,
    first.userContextId
  );
  const id = space.uuid;
  const current = () => gZenWorkspaces.getWorkspaceFromId(id);
  try {
    const initial = (await collectProjections()).get(id).data;
    Assert.equal(initial.containerRevision, 0, "Unedited assignment starts at zero");
    await gZenWorkspaces.contextChangeContainerTab({
      target: { getAttribute: () => String(second.userContextId) },
    });
    Assert.equal(current().containerTabId, second.userContextId, "Local edit applies");
    const updated = (await collectProjections()).get(id).data;
    Assert.equal(updated.containerRevision, 1, "Explicit edit advances revision");

    function record(data) {
      return { id, deleted: false, cleartext: { kind: "space", data } };
    }
    const stale = { ...initial, name: "Remote rename", children: [] };
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([record(stale)]),
      [],
      "Stale space record still applies unrelated fields"
    );
    Assert.equal(current().containerTabId, second.userContextId, "Stale assignment ignored");
    Assert.equal(current().name, "Remote rename", "Remote name still applies");
    const projected = (await collectProjections()).get(id).data;
    Assert.equal(projected.containerGuid, updated.containerGuid, "Projection preserves local assignment");
    Assert.equal(projected.containerRevision, 1, "Unrelated edit preserves revision");
    Assert.ok(id in ZenSpacesSyncModel.computeChangedIDs(), "Corrected assignment will re-upload");

    const legacy = { ...stale };
    delete legacy.containerRevision;
    Assert.deepEqual(await ZenSpacesSyncApplier.applyBatch([record(legacy)]), []);
    Assert.equal(current().containerTabId, second.userContextId, "Legacy record cannot roll back explicit edit");

    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        record({ ...initial, containerRevision: 2 }),
      ]),
      [],
      "Newer explicit remote assignment applies"
    );
    Assert.equal(current().containerTabId, first.userContextId, "Remote reassignment accepted");
    Assert.equal(current().containerRevision, 2, "Remote revision retained");
    Assert.deepEqual(
      await ZenSpacesSyncApplier.applyBatch([
        record({ ...initial, containerGuid: null, containerRevision: 3 }),
      ]),
      []
    );
    Assert.equal(current().containerTabId, 0, "Newer explicit removal applies");
    Assert.equal(current().containerRevision, 3, "Removal revision retained");
  } finally {
    await gZenWorkspaces.removeWorkspace(id);
    ContextualIdentityService.remove(first.userContextId);
    ContextualIdentityService.remove(second.userContextId);
    ZenSpacesSyncModel.noteApplied(id, null);
  }
});
