"use client";

type ProfileAvatarProps = {
  photoUrl?: string | null;
  initials: string;
  className?: string;
  imageClassName?: string;
  testId?: string;
};

export function ProfileAvatar({
  photoUrl,
  initials,
  className = "flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-xl font-bold text-white",
  imageClassName = "h-full w-full object-cover",
  testId
}: ProfileAvatarProps) {
  if (photoUrl) {
    return (
      <div className={className} data-testid={testId}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="" className={imageClassName} data-testid={testId ? `${testId}-image` : undefined} />
      </div>
    );
  }

  return (
    <div className={className} data-testid={testId}>
      {initials}
    </div>
  );
}
