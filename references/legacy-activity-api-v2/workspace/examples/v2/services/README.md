# Independently approved V2 services

Import `tmdb-movie.json` through the Library's service policy review. Enter your
TMDB API Read Access Token separately when approving it. The policy contains no
token. Approval grants the API and image destinations; an Activity cannot approve
them by declaring a lookup.

A schema version 2 Activity with an approved `title` field can declare:

```json
"lookup": { "service": "tmdb-movie", "input": { "query": "title" } }
```

The worker sends that title to the fixed TMDB search endpoint and derives artwork
only from a bounded poster filename. It never returns the response or token to
the page. Missing approval, token, permission, search results, or valid artwork
preserves the Activity's base presence. Results use the first search match; this
example does not establish an exact movie identity or include TV/episode lookup.

TMDB documents [movie search](https://developer.themoviedb.org/reference/search-movie),
[application authentication](https://developer.themoviedb.org/docs/authentication-application),
and [image URL construction](https://developer.themoviedb.org/docs/image-basics).
Use your own token and review the movie title sharing and both destinations before
approving the policy.
