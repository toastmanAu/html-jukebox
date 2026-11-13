// Share pages (/s/<album>/<track>) exist for link previews. A person who opens one goes on to the track.
const to = document.documentElement.dataset.to;
if (to && /^\/#music\/[a-z\d-]+\/\d+$/.test(to)) location.replace(to);
