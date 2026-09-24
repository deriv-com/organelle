export default function NotInDirectoryPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center px-4">
      <h1 className="text-lg font-semibold">
        Your account isn&apos;t in the directory yet
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You&apos;re signed in, but Organelle has no employee row for this email.
        That&apos;s expected until an administrator imports or creates your employee
        record. Try again after you appear in the directory.
      </p>
    </main>
  );
}
