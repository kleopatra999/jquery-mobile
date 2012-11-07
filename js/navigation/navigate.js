//>>excludeStart("jqmBuildExclude", pragmas.jqmBuildExclude);
//>>description: placeholder
//>>label: AJAX Navigation System
//>>group: Navigation
define([
	"jquery",
	"./../jquery.mobile.core",
	"./../jquery.mobile.support",
	"./events/navigate",
	"./path" ], function( $ ) {
//>>excludeEnd("jqmBuildExclude");

(function( $, undefined ) {
	var path = $.mobile.path, history, popstateEvent;

	// TODO consider queueing navigation activity until previous activities have completed
	//      so that end users don't have to think about it. Punting for now
	$.navigate = function( url, data, noEvents ) {
		var state;

		// NOTE we currently _leave_ the appended hash in the hash in the interest
		//      of seeing what happens and if we can support that before the hash is
		//      pushed down, though we note here that the # char is not permitted by
		//      rfc3986
		// IMPORTANT in the case where popstate is supported the event will be triggered
		//           directly, stopping further execution - ie, interupting the flow of this
		//           method call to fire bindings at this expression. Below the navigate method
		//           there is a binding to catch this event and stop its propagation.
		//
		//           We then trigger a new popstate event on the window with a null state
		//           so that the navigate events can conclude their work properly
		history.ignoreNextHashChange = true;
		window.location.hash = url;

		state = $.extend({
			url: url,
			title: document.title
		}, data);

		if( $.support.pushState ) {
			popstateEvent = new $.Event( "popstate" );
			popstateEvent.originalEvent = {
				type: "popstate",
				state: null
			};

			$.navigate.squash( url, state );

			// Trigger a new faux popstate event to replace the one that we
			// caught that was triggered by the hash setting above.
			if( !noEvents ) {
				history.ignoreNextPopState = true;
				$( window ).trigger( popstateEvent );
			}
		}

		// record the history entry so that the information can be included
		// in hashchange event driven navigate events in a similar fashion to
		// the state that's provided by popstate
		history.add( url, state );
	};

	// TODO this whole method is absolute trash :(
	// TODO move this into the path helpers
	$.navigate.squash = function( url, data ) {
		var state, href,
			isPath = path.isPath( url ),
			hash = isPath ? path.stripHash(url) : url,
			hashUri = path.parseUrl( hash ),
			resolutionUrl = isPath ? path.getLocation() : $.mobile.getDocumentUrl(),
			passedSearch, currentSearch, mergedSearch, preservedHash;

		// make the hash abolute with the current href
		href = path.makeUrlAbsolute( hash, resolutionUrl );

		// TODO all this crap is terrible, clean it up
		if ( isPath ) {
			passedSearch = hashUri.search;
			currentSearch = path.parseUrl( resolutionUrl ).search;
			mergedSearch = path.mergeSearch( currentSearch, passedSearch );

			// if we get a value back from the merged serve prepend a "?"
			mergedSearch = mergedSearch ? "?" + mergedSearch : "";

			// Get a hash where possible and, as long as it's not a path
			// preserve it on the current url
			preservedHash = (hashUri.hash || path.parseLocation().hash);
			preservedHash = path.isPath( preservedHash ) ? "" : preservedHash;

			// reconstruct each of the pieces with the new search string and hash
			href = path.parseUrl( href );
			href = href.protocol + "//" + href.host + href.pathname + mergedSearch + preservedHash;
			href = path.resetUIKeys( href );
		}

		// make sure to provide this information when it isn't explicitly set in the
		// data object that was passed to the squash method
		state = $.extend({
			hash: hash,
			url: href
		}, data);

		// replace the current url with the new href and store the state
		// Note that in some cases we might be replacing an url with the
		// same url. We do this anyways because we need to make sure that
		// all of our history entries have a state object associated with
		// them. This allows us to work around the case where $.mobile.back()
		// is called to transition from an external page to an embedded page.
		// In that particular case, a hashchange event is *NOT* generated by the browser.
		// Ensuring each history entry has a state object means that onPopState()
		// will always trigger our hashchange callback even when a hashchange event
		// is not fired.
		window.history.replaceState( state, state.title || document.title, href );

		return state;
	};

	// This binding is intended to catch the popstate events that are fired
	// when execution of the `$.navigate` method stops at window.location.hash = url;
	// and completely prevent them from propagating. The popstate event will then be
	// retriggered after execution resumes
	//
	// TODO grab the original event here and use it for the synthetic event in the
	//      second half of the navigate execution that will follow this binding
	$( window ).bind( "popstate.history", function( event ) {
		var hash, state;

		// Partly to support our test suite which manually alters the support
		// value to test hashchange. Partly to prevent all around weirdness
		if( !$.support.pushState ){
			return;
		}

		// If this is the popstate triggered by the actual alteration of the hash
		// swallow it completely to prevent handling
		if( history.ignoreNextHashChange ) {
			history.ignoreNextHashChange = false;
			event.stopImmediatePropagation();
			return;
		}

		// if this is the popstate triggered after the replaceState call in the navigate
		// method, then simply ignore it
		if( history.ignoreNextPopState ) {
			history.ignoreNextPopState = false;
			return;
		}

		// account for direct manipulation of the hash. That is, we will receive a popstate
		// when the hash is changed by assignment, and it won't have a state associated. We
		// then need to squash the hash. See below for handling of hash assignment that
		// matches an existing history entry
		if( !event.originalEvent.state ) {
			hash = path.parseLocation().hash;

			// avoid initial page load popstate trigger when there is no hash
			if( hash ) {

				var matchingIndex = history.closest( hash );

				state = $.navigate.squash( hash );

//				if( Math.abs(matchingIndex - history.activeIndex) > 1 ) {
					// record the new hash as an additional history entry
					// to match the browser's treatment of hash assignment
					history.add( hash, state );
//				}

				// pass the newly created state information
				// along with the event
				event.historyState = state;

				// do not alter history, we've added a new history entry
				// so we know where we are
				return;
			}
		}

		// If all else fails this is a popstate that comes from the back or forward buttons
		// make sure to set the state of our history stack properly, and record the directionality
		history.direct({
			url: (event.originalEvent.state || {}).hash || hash,

			// When the url is either forward or backward in history include the entry
			// as data on the event object for merging as data in the navigate event
			present: function( historyEntry, direction ) {
				event.historyState = historyEntry;
				event.historyState.direction = direction;
			}
		});
	});

	// NOTE must bind before `navigate` special event hashchange binding otherwise the
	//      navigation data won't be attached to the hashchange event in time for those
	//      bindings to attach it to the `navigate` special event
	// TODO add a check here that `hashchange.navigate` is bound already otherwise it's
	//      broken (exception?)
	$( window ).bind( "hashchange.history", function( event ) {
		var hash = path.parseLocation().hash;

		// If pushstate is supported the state will be included in the popstate event
		// data and appended to the navigate event. Late check here for late settings (eg tests)
		if( $.support.pushState ) {
			return;
		}

		// If the hashchange has been explicitly ignored or we have no history at
		// this point skip the history managment and the addition of the history
		// entry to the event for the `navigate` bindings
		if( history.ignoreNextHashChange ) {
			history.ignoreNextHashChange = false;
			return;
		}

		// If this is a hashchange caused by the back or forward button
		// make sure to set the state of our history stack properly
		history.direct({
			url: hash,

			// When the url is either forward or backward in history include the entry
			// as data on the event object for merging as data in the navigate event
			present: function( historyEntry, direction ) {
				event.hashchangeState = historyEntry;
				event.hashchangeState.direction = direction;
			},

			// When we don't find a hash in our history clearly we're aiming to go there
			// record the entry as new for future traversal
			//
			// NOTE it's not entirely clear that this is the right thing to do given that we
			//      can't know the users intention. It might be better to explicitly _not_
			//      support location.hash assignment in preference to $.navigate calls
			missing: function() {
				history.add( hash, {
					hash: hash,
					title: document.title,
					url: location.href
				});
			}
		});
	});

	// expose the history on the navigate method in anticipation of full integration with
	// existing navigation functionalty that is tightly coupled to the history information
	$.navigate.history = history = {
		// Array of pages that are visited during a single page load.
		// Each has a url and optional transition, title, and pageUrl (which represents the file path, in cases where URL is obscured, such as dialogs)
		stack: [],

		//maintain an index number for the active page in the stack
		activeIndex: 0,

		//get active
		getActive: function() {
			return this.stack[ this.activeIndex ];
		},

		getPrev: function() {
			return this.stack[ this.activeIndex - 1 ];
		},

		getNext: function() {
			return this.stack[ this.activeIndex + 1 ];
		},

		// addNew is used whenever a new page is added
		add: function( url, data ){
			data = data || {};

			//if there's forward history, wipe it
			if ( this.getNext() ) {
				this.clearForward();
			}

			data.url = url;
			this.stack.push( data );
			this.activeIndex = this.stack.length - 1;
		},

		//wipe urls ahead of active index
		clearForward: function() {
			this.stack = this.stack.slice( 0, this.activeIndex + 1 );
		},

		find: function( url, stack, earlyReturn ) {
			stack = stack || this.stack;

			var entry, i, length = stack.length, index;

			for ( i = 0; i < length; i++ ) {
				entry = stack[i];

				if ( decodeURIComponent( url ) === decodeURIComponent( entry.url ) ) {
					index = i;

					if( earlyReturn ) {
						return index;
					}
				}
			}

			return index;
		},

		closest: function( url ) {
			var closest, a = this.activeIndex;

			// First, take the slice of the history stack before the current index and search
			// for a url match. If one is found, we'll avoid avoid looking through forward history
			// NOTE the preference for backward history movement is driven by the fact that
			//      most mobile browsers only have a dedicated back button, and users rarely use
			//      the forward button in desktop browser anyhow
			closest = this.find( url, this.stack.slice(0, a) );

			// If nothing was found in backward history check forward. The `true`
			// value passed as the third parameter causes the find method to break
			// on the first match in the forward history slice. The starting index
			// of the slice must then be added to the result to get the element index
			// in the original history stack :( :(
			//
			// TODO this is hyper confusing and should be cleaned up (ugh so bad)
			if( closest === undefined ) {
				closest = this.find( url, this.stack.slice(a + 1), true );
				closest = closest === undefined ? closest : closest + a + 1;
			}

			return closest;
		},

		direct: function( opts ) {
			var newActiveIndex = this.closest(opts.url), a = this.activeIndex;

			// save new page index, null check to prevent falsey 0 result
			this.activeIndex = newActiveIndex !== undefined ? newActiveIndex : this.activeIndex;

			// invoke callbacks where appropriate
			//
			// TODO this is also convoluted and confusing
			if ( newActiveIndex < a ) {
				( opts.present || opts.back || $.noop )( this.getActive(), 'back' );
			} else if ( newActiveIndex > a ) {
				( opts.present || opts.forward || $.noop )( this.getActive(), 'forward' );
			} else if ( newActiveIndex === a ) {
				if( opts.current ) {
					opts.current( this.getActiveIndex );
				}
			} else if ( opts.missing ){
				opts.missing( this.getActive() );
			}
		},

		//disable hashchange event listener internally to ignore one change
		//toggled internally when location.hash is updated to match the url of a successful page load
		ignoreNextHashChange: false
	};

	var loc = path.parseLocation();

	// Record the initial page with a replace state where necessary
	history.add( loc.href, {
		hash: loc.pathname + loc.search
	});
})( jQuery );

//>>excludeStart("jqmBuildExclude", pragmas.jqmBuildExclude);
});
//>>excludeEnd("jqmBuildExclude");
