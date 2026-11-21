// Fetches Roblox user details, profile link, and avatar thumbnail from public Roblox APIs
async function getRobloxProfile(username) {
  if (!username) return null;
  const cleanUsername = String(username).replace(/[@#]/g, '').trim();
  if (!cleanUsername) return null;

  try {
    // 1. Get User ID from username
    const res = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames: [cleanUsername],
        excludeBannedUsers: false,
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const user = json?.data?.[0];
    if (!user || !user.id) return { notFound: true, username: cleanUsername };

    // 2. Get Avatar Headshot thumbnail (150x150 PNG)
    let avatarUrl = null;
    try {
      const thumbRes = await fetch(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`
      );
      if (thumbRes.ok) {
        const thumbData = await thumbRes.json();
        avatarUrl = thumbData?.data?.[0]?.imageUrl || null;
      }
    } catch {
      // fallback if thumbnail endpoint fails
    }

    return {
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      profileUrl: `https://www.roblox.com/users/${user.id}/profile`,
      avatarUrl,
      notFound: false,
    };
  } catch (err) {
    console.error('Error fetching Roblox profile:', err);
    return null;
  }
}

module.exports = { getRobloxProfile };
