# DHL Tracking v6 Test Deployment

Your stable rollback point remains:

- Branch: `main`
- Tag: `v5.2.0-stable`

## 1. Create a test branch

From PowerShell:

```powershell
cd C:\jiraapps\dhl-tracking-app
git switch -c marketplace-v6-test
```

## 2. Copy the v6 files into the project

Extract this package and copy its contents over:

```text
C:\jiraapps\dhl-tracking-app
```

Allow Windows to replace existing files.

## 3. Install dependencies

```powershell
npm install
```

## 4. Validate before deployment

```powershell
forge lint
```

Do not continue if Forge reports red errors.

## 5. Deploy to development

```powershell
forge deploy -e development
```

## 6. Upgrade the development installation

v6 adds an admin configuration page and storage permissions, so run:

```powershell
forge install --upgrade -e development
```

## 7. Open the configuration page

In Jira, go to:

```text
Jira settings / Administration -> Apps -> DHL Tracking -> Configure
```

Configure and save:

- DHL API key
- Project key
- Jira field mappings
- Workflow status mappings
- Delivery Status values
- Internal comment templates

Use the Test DHL connection button with a known tracking number.

## 8. Check logs

```powershell
forge logs -e development
```

Look for the v6 scheduler startup and any mapping/permission errors.

## 9. Commit the v6 test branch only after it validates

```powershell
git add .
git commit -m "DHL Tracking v6 configurable test build"
```

Do not merge this branch into `main` until testing is successful.

## Roll back to the known stable version

If v6 causes problems:

```powershell
git switch main
git reset --hard v5.2.0-stable
npm install
forge deploy -e development
```

If v6 changed app permissions/modules and you need to restore the installation metadata too, run:

```powershell
forge install --upgrade -e development
```

## Important

The v5.2.0 stable tag is not changed by testing v6 on a separate branch.
