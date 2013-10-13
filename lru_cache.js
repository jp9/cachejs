/*global module:false*/
/*jshint strict:false unused:true smarttabs:true eqeqeq:true immed: true undef:true*/
/*jshint maxparams:7 maxcomplexity:8 maxlen:150 devel:true newcap:false*/ 

//LRU cache implementation using doubly linked lists:

//TODO filter out large entries over a certain threshold to make room
//for lots of small values
//TODO keep a value in cache no matter what if its flag is set
//TODO optimize arrays:
// http://gamealchemist.wordpress.com/2013/05/01/lets-get-those-javascript-arrays-to-work-fast/

//TODO maintain 2 LRUs in one cache for ARC purposes. Move the lru of
//the top list to resize both

//For a simple LRU implementation using arrays see lru_cache_simple in
//this repo, copied from connect middleware staticCache.

//For a basic single LRU using dbly linked lists see lru_cache.js

//This version lets you share the same store, emptyslots and lookup
//with server arrays, mainly useful for arch_cache.js. It also lets
//you call the cache asynchronously. Its api is interchangeable with
//arc_cache.js

function getCache(maxLen, store, emptySlots, lookup){
    
    var lruIndex, lru, mruIndex, mru;
    var length;
    
    function init(){ 
        // TODO: to use this possibily faster array allocation, adding new
        // elements has to be done by hand cacheArray = cacheArray ||
        // there's 2 here and one in cache 
        // new Array(maxLen);
        store = store || [];
        emptySlots = emptySlots || [];
        lookup = lookup || {};
        length = 0;
        
        lruIndex = store.length;
        lru = {};
        //rewrite this push array is preallocated
        store.push(lru);
        mruIndex = store.length;
        mru = { prev: lruIndex };
        //rewrite this push array is preallocated
        store.push(mru);
        lru.next = mruIndex;
    
        maxLen = maxLen || 128;
    
    }

    //make the neighbours of a value point to eachother, cutting the
    //value itself out of the list:
    function bridge(index, val) {
        var prev = val.prev;
        var next = val.next;
        //the neighbour below has to point to the neighbour above:
        store[prev].next = next;
        //and the neighbour above to the neighbour below:
        store[next].prev = prev;
    }

    //move the value to the top of the list:
    function touch(touching, val) {
        //nothing to do:
        if (touching === mru.prev) return;
        bridge(touching, val);
        //point down to the old mru:
        val.prev = mru.prev;
        //point up to whatever was above mru
        val.next = mruIndex;
        //and point back:
        mru.prev = touching;
        //the old mru has to point up the new one:
        store[val.prev].next = touching;
        
    }

    var requesters = {};

    
    //call cache with a key and a callback. The callback gets the
    //value passed in. If the cache actually doesn't have the value,
    //and it's the first time it's been asked for it then the function
    //returns false. In that case you need to get the resource (async
    //perhaps). When you have the resource, call cache again, this
    //time with the value as the 2nd param however. The function will
    //call the callbacks of all cache requests that occured before the
    //resource was available. 
    function cache(key, value, size){
        var  cb;
        if (typeof value === 'function') {
            cb = value;
            var index = lookup[key];
            if (index) {
                val =store[index];
                touch(index, val);
                cb(val.val);   
                return true; 
            }
            else {
                
                //get in line!!!
                requesters[key] =  requesters[key] || [];
                requesters[key].push(cb);
                //we don't have it, return false  to notify the caller
                //he has to go and get it, and then call this function
                //again, but with key, value and size instead as
                //params A second or 3rd etc time though just return
                //true , after having stored the callback
                return requesters.length > 1;
            } 
        } 
        //wrap the value so we can place it in our cache:
        var val = {
            key: key,
            val: value,
            size: size || value.length || 0
        };
        var emptySlot = lookup[key];
        if (emptySlot) {
            store[emptySlot] = val;
            touch(emptySlot, val);
        }
        //emptySlot points at the end of the cache:
        //if we have room still just add it to the cache:
        else {
            if (length + emptySlots.length < maxLen) {
                emptySlot = store.length;
                //TODO for speed maybe don't push but use a counter and just assign
                store.push(val);   
                length++;
            }
            else {
                if (emptySlots.length)  {
                    //TODO also for speed maybe use counter
                    emptySlot = emptySlots.pop();
                    //we found an empty slot so we need to incr the len of the cache
                    length++;
                } 
                //if there were no empty slots then..
                else {
                    var lruVal = store[lru.next];
                    //we need to drop the lru to make room for our new value:
                    delete lookup[lruVal.key];
                    //emptySlot is now pointing to the old lru
                    emptySlot = lru.next;
                    //cut lru out of the list:
                    bridge(emptySlot, lruVal);
                }
                //assign the value to the empty slot:
                store[emptySlot] = val;
            }
            //link up 
            val.prev = mru.prev;
            mru.prev = emptySlot;
            store[val.prev].next = emptySlot;
            val.next = mruIndex;
            //look up values by key in a hashtable, and point mru at
            //our new value:
            lookup[key] = mru.prev = emptySlot;
        } 
        //we've got a value for a key, let's pass it on to the queue
        //of requesters:
        if (requesters[key]) {
            requesters[key].forEach(function(cb) {
                cb(value);
            });
            delete requesters[key];
        }
        return true;
    }

    
    function Typeof(v) {
        var type = {}.toString.call(v);
        return type.slice(8, type.length-1);
    }
    
    //str, array, or regexp, will call elide to do the work:
    //any value will be deleted
    function remove(keys){
        if (!keys) return;
        if (Typeof(keys) === 'RegExp') {
            keys = Object.keys(lookup).filter(function(k) {
                return keys.test(k) ;
            });
        }
        else if (typeof keys === 'string') keys = [keys]; 
        keys.forEach(function(k) {
            var val = elide(k);
            delete val.val;
            
            val._deleted = true;
            
        });
    }


    //return a list ordered by mru, filtered by the regexp if passed
    //in:
    function list(regExp){
        // console.log('lru', lru);
        // console.log('mru', mru);
        // console.log(lookup);
        // console.log(store);
        // console.log(length);
        regExp = regExp || /.*/;
        var result = [];
        var prev = mru.prev;
        if (!length) return [];
        var i=0;
        while (i < maxLen) {
            var entry = store[prev];
            if (regExp.test(entry.key)) result.push(entry.key);
            i++;
            if (prev === lru.next) return result;
            prev = entry.prev;
        }
        return result;
    }

    function stats(){
        return {
            len: Object.keys(lookup).length,
            size: (function() {
                return store.reduce(function(s, e) {
                    return (e.size || 0) + s; 
                }, 0);
            })()
        };
    }
    
    //has to be done key by key because lru's and mru's of other
    //caches might be floating around in store. It would be quicker to
    //just create a new cache and discard the old one as an api user.
    function flush() {
        // remove(/.*/);
        //or
        var keys = [];
        Object.keys(lookup).forEach(function(k) {
            keys.push(k);
        });
        remove(keys);                         
    }
    
    
    //***************arc cache api*******************************************
    
    function get(key) {
        var index = lookup[key];
        if (index) {
            var val = store[index];
            touch(index, val);
            return store[index].val;   
        }
        else return undefined;
    }
    
    function del(key) {
        var value = elide(key);
        if (value) delete value.val;
    }
    
    //cut a value out of the links, but leave the value intact:
    function elide(key) {
        var index = lookup[key];
        //if value is not present in cache we're done:
        if (!index) return undefined;
        //delete from lookup
        delete lookup[key];
        var deletedValue = store[index];
        //fix up the dbly linked list now:
        //break its links and bridge the gap: 
        bridge(index, deletedValue);
        //keep track of empty slots:
        emptySlots.push(index);
        //can't look it up anymore:
        delete lookup[key];
        //one less value in the cache:
        length--;
        //be polite and return the elided value:
        return deletedValue;
    }
    
    
    function delLru() {
        // var index = lru;
        // var val = cache[index];
        // var key = val.key;
        // delete lookup[key];
        // // val.deleted = true;
        // // delete val.key;
        // delete val.val;
        // bridge(val);
        // var lruVal = cache[lru];
        // val.prev = lruVal.prev;
        // lruVal.prev = index;
        // val.next = lru;
        // if (val.prev) cache[val.prev].next = index;
        // length--;
        // return key;
        // or:
        if (!length) return;
        var val = store[lru.next];
        delete val.val;
        elide(val.key);
    }
    
    //same as delLru except it returns a special data structure used
    //by setMru again, don't call this on an empty cache:
    function cutLru() {
        var index = lru.next;
        var value = store[index];
        bridge(index, value);
        length--;
        return { index: index, value: value };
    }
    
    //splice data.value into the mru pos:
    function setMru(data) {
        var value = data.value;
        var index = data.index;
        delete value.val;
        value.next = mruIndex;
        value.prev = mru.prev;
        mru.prev = index;
        store[value.prev].next = index;
        length++;
    }
    
    init();
    
    return {
        //async:
        cache: cache, //an assumed miss, not an update, though it will
                      //update the value if it is found in the
                      //cache. In //both cases the value will be put
                      //at the top of the list.
        //sync:
        has: function(key) { return lookup[key]; },
        get: get,
        put: function(key, value, size) {
            cache(key, value, size);
            return value;
        },
        del: del,
        remove: remove, //convenience wrapper to selectively flush the
                        //cache by key, [keys] or /key/
        flush: flush, //completely empty out the cache
        list: list, //return a list of the cache contents, filtered by
                    //a regexp if passed in
        stats: stats, //return len and size of of cache. size will
                      //only be accurate if a size param is present in
                      //every put call or every value stored is in
                      //string form
        length: function() { return length; }, //returns the actual number of values in the cache
        
        //api for ARC-cache:
        delLru: delLru //deletes the lru from the cache
        ,mru: function() { return mru.prev; }
        ,lru: function() { return lru.next; }
        ,cutLru: cutLru
        ,setMru: setMru
        ,elide: elide //only cuts the value out of the links and returns it
    };
}

//getCache(maxLen (128), store ([]), emptySlots ([]), lookup ({}))
module.exports = getCache;
