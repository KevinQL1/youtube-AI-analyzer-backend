export const parseISO8601Duration = (durationString) => {
    if (!durationString) return 0;
    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
    const matches = durationString.match(regex);
    if (!matches) return 0;

    const hours = parseInt(matches[1] || 0, 10);
    const minutes = parseInt(matches[2] || 0, 10);
    const seconds = parseInt(matches[3] || 0, 10);

    return hours * 3600 + minutes * 60 + seconds;
};