# Maintenance as a Version of the Production Stack (approach A)

## Why one stack

A Staticbot stack's domain is fixed once its deployment is created, and one hostname cannot be attached to two stacks (CloudFront aliases and Cloudflare custom hostnames are exclusive). A separate maintenance stack would lock the domain away from the app. Instead, the production stack serves two **website versions** of the same template family in turn:

- `V_app`: the tested app build, pointing at the final target (the rehearsal target, cleaned and reused, so its URL and keys stay valid).
- `V_maint`: the same repository and branch with a maintenance commit on top.

`redeploy_website` and `rollback_website` swap the site version in place on the same deployment: same infrastructure, same domain, same certificate, no new DNS. This works for AWS static and Cloudflare Workers deployments alike. `rollback_website` only offers versions that were already deployed to that deployment. That is why the order below deploys `V_app` first.

## Prerequisites

- Final-copy strategy is **clean-and-reuse**. With a fresh target, `V_app` would point at the wrong project; use approach B.
- The production stack's template is commit-pinned (versions minted per push), not floating on a branch name. Check `get_template`: a `repoVersion` that is a branch name means floating. If it floats, stop and use approach B.
- The user authorizes the agent to push to the branch the production template builds from (read it from the template; for migrated apps this is usually Staticbot's `staticbot/live` branch, never the builder's own branch).
- Continuous Sync for this project is `PAUSED` for the whole window (`set_connected_project_sync_mode`), so no sync run or preview promotion redeploys the stack underneath you.

## The maintenance commit

Make the smallest change that makes the build render only the maintenance page from [assets/maintenance/index.html](../assets/maintenance/index.html) (placeholders filled in):

- **SPA / static (AWS static):** replace the app's entry HTML body with the maintenance markup and remove the module script tag, so no app code loads. Keep the build command working.
- **SSR (Cloudflare Workers):** make the root route or layout return the maintenance markup for every path, without touching data loaders that call the backend.

Build locally once to prove it still compiles. Commit with a message such as `chore: maintenance page for cutover (revert after reopening)`.

## Pre-stage sequence (phase 2, before any traffic reaches the stack)

1. Create the production stack on the custom domain from the tested app template (deploy skill, `CUSTOM_DOMAIN`). Publish **only** the certificate-validation records. It deploys `V_app`.
2. Turn off automatic website updates for this deployment (`update_auto_deploy_settings` with `autoDeployLatestWebsite: false`).
3. Push the maintenance commit. Deploy it with `redeploy_website` (`useLatest: true`). The stack now serves `V_maint`; still nobody reaches it.
4. Revert the maintenance commit on the branch right away (a normal `git revert`, pushed). The branch is back to app code for the final migration and later syncs. The deployment keeps serving `V_maint` because automatic updates are off.
5. Call `list_rollback_versions`. Both `V_app` and `V_maint` must appear as separate commit-pinned entries. Record their `templateId`s and commits in the state file.
6. **Rehearse the swap:** `rollback_website` to `V_app`, check it through the stack's Staticbot URL, then back to `V_maint` the same way (`V_maint` is now a previously deployed version). Record how long each swap took; it is part of the window.

If step 5 or 6 fails, use approach B. The DNS for the domain has not changed yet, so nothing is lost.

## During the window

- **Maintenance on (phase 3):** the stack already serves `V_maint`. Move the domain's routing record from the builder to the production stack. Check HTTPS and the maintenance page on the real domain.
- **Verification (phase 5):** verify on the final migration's preview URL, not the real domain. The real domain shows maintenance until reopening.
- **Reopen (phase 6):** with the user's approval, `rollback_website` to `V_app`. Poll `get_deployment` until complete, then check the real domain.
- **Pre-write recovery:** the stack keeps `V_maint`; restore the saved builder DNS records.

## After reopening

Turn automatic website updates back on only if the user wants them, and resume Continuous Sync in the chosen mode. The maintenance commit and its revert stay in history; they cancel out.
